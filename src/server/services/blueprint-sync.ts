import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { shows } from '../db/schema';
import { writeAudit } from '../audit';
import { keyIdOf, keyMatches } from '../security/connection-key';
import { applyList, MAX_ROWS, type ListRow } from './exhibitors';
import { isValidEmail } from '../auth/login';
import { systemActor } from '../auth/actor';
import type { ShowRow } from './shows';

/**
 * BluePrint sends a show's whole exhibitor list (POST /api/public/shows/<slug>/exhibitors, the
 * show's key as a bearer token). Guide for BluePrint's side: docs/blueprint.md.
 */

/** The show a key belongs to, if it is that show's current key. Same answer for every kind of wrong. */
export async function showForKey(slug: string, key: string | null): Promise<ShowRow | null> {
  const keyId = key ? keyIdOf(key) : null;
  if (!key || !keyId || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const db = await getDb();
  const [show] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1);
  if (!show || show.status === 'archived' || show.connectionKeyId !== keyId || !show.connectionKeyHash) return null;
  return keyMatches(key, show.connectionKeyHash) ? show : null;
}

const text = (max: number) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max)));

const contactSchema = z.object({
  name: text(120),
  email: z.string().max(254),
  phone: text(40),
});

const exhibitorSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim())
    .pipe(z.string().max(200))
    .nullish(),
  company: text(200).pipe(z.string().min(1, 'Give each exhibitor a company name.')),
  stand: text(40).pipe(z.string().min(1, 'Give each exhibitor a stand number.')),
  hall: text(80),
  standType: text(80),
  contacts: z.array(contactSchema).max(50),
});

const bodySchema = z.object({ exhibitors: z.array(z.unknown()) });

export type SyncRead = { ok: true; rows: ListRow[]; skipped: number } | { ok: false; error: string };

/** BluePrint's list, checked like a spreadsheet; or what's wrong with it, in words BluePrint's developer can act on. */
export function readSyncBody(input: unknown): SyncRead {
  const top = bodySchema.safeParse(input);
  if (!top.success) return { ok: false, error: 'Send JSON with an "exhibitors" list: { "exhibitors": [ … ] }.' };
  const rows: ListRow[] = [];
  let skipped = 0;
  for (let i = 0; i < top.data.exhibitors.length; i++) {
    const parsed = exhibitorSchema.safeParse(top.data.exhibitors[i]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { ok: false, error: `Check exhibitors.${[i, ...issue.path].join('.')}: ${issue.message}` };
    }
    const e = parsed.data;
    let usable = 0;
    for (const c of e.contacts) {
      const email = c.email.trim().toLowerCase();
      if (!isValidEmail(email)) continue;
      usable++;
      rows.push({ company: e.company, stand: e.stand, hall: e.hall, standType: e.standType, name: c.name, email, phone: c.phone, externalId: e.id ?? null });
    }
    if (!usable) skipped++;
    if (rows.length > MAX_ROWS) return { ok: false, error: `That's more than ${MAX_ROWS.toLocaleString('en-GB')} contacts. Send up to ${MAX_ROWS.toLocaleString('en-GB')} per show.` };
  }
  if (!rows.length) return { ok: false, error: 'No exhibitor has a usable email address. An empty list is treated as a mistake, so nothing changed.' };
  return { ok: true, rows, skipped };
}

/** Replaces the show's list with BluePrint's. Contacts left out are removed and their sign-ins end. */
export async function syncFromBlueprint(show: ShowRow, rows: ListRow[], ctx: { ip?: string | null; userAgent?: string | null }) {
  const actor = systemActor('BluePrint', { ...ctx, api: true });
  const db = await getDb();
  return db.transaction(async (tx) => {
    const plan = await applyList(tx, show.id, rows, { replace: true, source: 'blueprint' });
    await tx.update(shows).set({ lastListSyncAt: new Date() }).where(eq(shows.id, show.id));
    const c = plan.counts;
    // Recorded only when something changed, so a nightly resend doesn't fill the log.
    if (c.add || c.update || c.remove) {
      await writeAudit(tx, actor, {
        action: 'exhibitors.synced',
        summary: `BluePrint sent the exhibitor list: ${c.add} added, ${c.update} changed, ${c.remove} removed`,
        entityType: 'show',
        entityId: show.id,
        showId: show.id,
        details: { counts: c },
      });
    }
    return { contacts: c.add + c.update + c.same, added: c.add, updated: c.update, removed: c.remove, skipped: c.skip };
  });
}
