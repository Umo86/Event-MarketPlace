import 'server-only';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { auditLog, shows } from '../db/schema';
import { authorize } from '../authz';
import { invalid } from '../errors';
import { writeAudit } from '../audit';
import { getPlatformBranding, putSetting } from './settings';
import { checkAccentColour, checkMainColour } from '@/lib/branding';
import type { Actor, UserActor } from '../auth/actor';

export const platformBrandingSchema = z.object({
  marketplaceName: z.string().trim().min(1, 'Give the platform a name.').max(80),
  primaryColor: z.string().trim().max(20),
  accentColor: z.string().trim().max(20),
});

/** The look of storefronts without their own branding. Super admins only. */
export async function updatePlatformBranding(actor: UserActor, input: z.infer<typeof platformBrandingSchema>) {
  await authorize(actor, 'platform.settings.edit', {}, { write: true });
  const main = checkMainColour(input.primaryColor);
  const accent = checkAccentColour(input.accentColor);
  const fieldErrors: Record<string, string> = {};
  if (!main.ok) fieldErrors.primaryColor = main.message;
  if (!accent.ok) fieldErrors.accentColor = accent.message;
  if (!main.ok || !accent.ok) throw invalid('Check the colours: they need to be easy to read.', fieldErrors);
  const db = await getDb();
  const current = await getPlatformBranding(db);
  await db.transaction(async (tx) => {
    await putSetting(tx, 'branding', { ...current, marketplaceName: input.marketplaceName, primaryColor: main.colour, accentColor: accent.colour }, actor.userId);
    await writeAudit(tx, actor, { action: 'platform.branding_updated', summary: 'Changed the platform’s default name or colours', details: { marketplaceName: input.marketplaceName, primaryColor: main.colour, accentColor: accent.colour } });
  });
}

/** The newest audit entries, 100 at a time. Super admins see everything; a show's admins see their show. */
export async function auditEntries(actor: Actor, opts: { showId?: string | null; before?: Date | null } = {}) {
  if (opts.showId) await authorize(actor, 'show.audit.view', { showId: opts.showId });
  else await authorize(actor, 'platform.audit.view');
  const db = await getDb();
  const where: SQL[] = [];
  if (opts.showId) where.push(eq(auditLog.showId, opts.showId));
  if (opts.before) where.push(lt(auditLog.at, opts.before));
  return db
    .select({ entry: auditLog, showName: shows.name })
    .from(auditLog)
    .leftJoin(shows, eq(shows.id, auditLog.showId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLog.at))
    .limit(100);
}
