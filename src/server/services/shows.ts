import 'server-only';
import { and, asc, eq, inArray, isNull, gt } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type DbLike } from '../db/client';
import { invitations, SHOW_PERMISSIONS, SHOW_ROLES, SHOW_STATUSES, showStaff, shows, standTypes, users, type ShowPermission } from '../db/schema';
import { authorize, staffShowIds } from '../authz';
import { conflict, invalid, notFound } from '../errors';
import { writeAudit } from '../audit';
import { encryptSecret } from '../security/crypto';
import { keyHashOf, newConnectionKey, signingKeyOf } from '../security/connection-key';
import { getPlatformBranding } from './settings';
import { storeImage, type ImageKind } from './files';
import { parseLocalDateTime } from '@/lib/dates';
import { slugProblem, slugify } from '@/lib/slug';
import { checkAccentColour, checkMainColour, resolveBranding, type ResolvedBranding, type ShowBranding } from '@/lib/branding';
import type { Actor, UserActor } from '../auth/actor';

export type ShowRow = typeof shows.$inferSelect;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getShow(showId: string, db?: DbLike): Promise<ShowRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(showId)) return null;
  const d = db ?? (await getDb());
  const [row] = await d.select().from(shows).where(eq(shows.id, showId)).limit(1);
  return row ?? null;
}

/** The show behind a storefront address. Archived shows are gone from the web. */
export async function getShowBySlug(slug: string): Promise<ShowRow | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const db = await getDb();
  const [row] = await db.select().from(shows).where(eq(shows.slug, slug)).limit(1);
  return row && row.status !== 'archived' ? row : null;
}

export async function brandingFor(show: Pick<ShowRow, 'name' | 'branding'>, db?: DbLike): Promise<ResolvedBranding> {
  return resolveBranding(show, await getPlatformBranding(db));
}

/** Shows someone can open in the admin area: all of them for super admins. */
export async function listShowsFor(actor: Actor) {
  await authorize(actor, 'shows.list');
  const db = await getDb();
  const ids = await staffShowIds(actor);
  if (ids && !ids.length) return [];
  const rows = await db
    .select()
    .from(shows)
    .where(ids ? inArray(shows.id, ids) : undefined)
    .orderBy(asc(shows.status), asc(shows.name));
  return rows;
}

// ---------------------------------------------------------------------------
// Creating and editing
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

export const createShowSchema = z.object({
  name: z.string().trim().min(3, 'Give the show a name.').max(120),
  slug: z.string().trim().toLowerCase().max(60).optional(),
  venue: optionalText(120),
});

export async function createShow(actor: UserActor, input: z.infer<typeof createShowSchema>) {
  await authorize(actor, 'shows.create', {}, { write: true });
  const slug = input.slug || slugify(input.name);
  const problem = slugProblem(slug);
  if (problem) throw invalid(problem, { slug: problem });
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: shows.id }).from(shows).where(eq(shows.slug, slug)).limit(1);
    if (taken) throw invalid('Another show already uses that web address.', { slug: 'Another show already uses that web address.' });
    const [show] = await tx.insert(shows).values({ name: input.name, slug, venue: input.venue ?? null }).returning();
    // Every show starts with the two stand types Media10 uses; uploads add any others.
    await tx.insert(standTypes).values([
      { showId: show.id, key: 'shell_scheme', name: 'Shell scheme', sort: 0 },
      { showId: show.id, key: 'space_only', name: 'Space only', sort: 1 },
    ]);
    await writeAudit(tx, actor, { action: 'show.created', summary: `Created the show ${show.name} at /${slug}`, entityType: 'show', entityId: show.id, showId: show.id });
    return show;
  });
}

const dateField = z
  .string()
  .trim()
  .max(30)
  .nullish()
  .transform((v) => v || null);

export const showSettingsSchema = z.object({
  showId: z.string().uuid(),
  name: z.string().trim().min(3, 'Give the show a name.').max(120),
  venue: optionalText(120),
  status: z.enum(SHOW_STATUSES),
  orderingOpensAt: dateField,
  earlyBirdEndsAt: dateField,
  latePricesFrom: dateField,
  orderingClosesAt: dateField,
  helpEmail: z
    .string()
    .trim()
    .max(254)
    .transform((v) => v.toLowerCase() || null)
    .pipe(z.string().email('Enter a valid email address.').nullable())
    .nullish(),
  helpPhone: optionalText(40),
  billieUrl: z
    .string()
    .trim()
    .max(300)
    .transform((v) => v || null)
    .pipe(z.string().url('Enter the full web address, starting https://').refine((v) => v.startsWith('https://'), 'Enter the full web address, starting https://').nullable())
    .nullish(),
});

/** Ordering dates must run in order: opens, early-bird ends, late prices start, closes. */
export function orderingDateProblems(d: { orderingOpensAt: Date | null; earlyBirdEndsAt: Date | null; latePricesFrom: Date | null; orderingClosesAt: Date | null }): Record<string, string> {
  const problems: Record<string, string> = {};
  const seq: [keyof typeof d, string][] = [
    ['orderingOpensAt', 'Ordering opens'],
    ['earlyBirdEndsAt', 'Early-bird prices end'],
    ['latePricesFrom', 'Late prices start'],
    ['orderingClosesAt', 'Ordering closes'],
  ];
  for (let i = 0; i < seq.length; i++) {
    for (let j = i + 1; j < seq.length; j++) {
      const a = d[seq[i][0]];
      const b = d[seq[j][0]];
      if (a && b && b.getTime() < a.getTime() && !problems[seq[j][0]]) {
        problems[seq[j][0]] = `${seq[j][1]} must come after "${seq[i][1].toLowerCase()}".`;
      }
    }
  }
  return problems;
}

export async function updateShowSettings(actor: UserActor, raw: z.input<typeof showSettingsSchema>) {
  const input = showSettingsSchema.parse(raw);
  await authorize(actor, 'show.settings.edit', { showId: input.showId }, { write: true });
  const db = await getDb();
  const show = await getShow(input.showId, db);
  if (!show) throw notFound();
  const dates = {
    orderingOpensAt: input.orderingOpensAt ? parseLocalDateTime(input.orderingOpensAt, show.timezone) : null,
    earlyBirdEndsAt: input.earlyBirdEndsAt ? parseLocalDateTime(input.earlyBirdEndsAt, show.timezone) : null,
    latePricesFrom: input.latePricesFrom ? parseLocalDateTime(input.latePricesFrom, show.timezone) : null,
    orderingClosesAt: input.orderingClosesAt ? parseLocalDateTime(input.orderingClosesAt, show.timezone) : null,
  };
  const bad: Record<string, string> = {};
  for (const [k, raw] of Object.entries({ orderingOpensAt: input.orderingOpensAt, earlyBirdEndsAt: input.earlyBirdEndsAt, latePricesFrom: input.latePricesFrom, orderingClosesAt: input.orderingClosesAt })) {
    if (raw && !dates[k as keyof typeof dates]) bad[k] = 'Enter a date and time.';
  }
  const order = orderingDateProblems(dates);
  const problems = { ...order, ...bad };
  if (Object.keys(problems).length) throw invalid('Check the ordering dates.', problems);
  const values = {
    name: input.name,
    venue: input.venue ?? null,
    status: input.status,
    ...dates,
    helpEmail: input.helpEmail ?? null,
    helpPhone: input.helpPhone ?? null,
    billieUrl: input.billieUrl ?? null,
  };
  await db.transaction(async (tx) => {
    await tx.update(shows).set(values).where(eq(shows.id, show.id));
    const changed = Object.keys(values).filter((k) => String(values[k as keyof typeof values] ?? '') !== String(show[k as keyof ShowRow] ?? ''));
    await writeAudit(tx, actor, {
      action: 'show.settings_updated',
      summary: changed.length ? `Changed ${changed.join(', ')}` : 'Saved the show settings (no changes)',
      entityType: 'show',
      entityId: show.id,
      showId: show.id,
      details: { changed, status: show.status === input.status ? undefined : { from: show.status, to: input.status } },
    });
  });
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------

export const brandingSchema = z.object({
  showId: z.string().uuid(),
  marketplaceName: z.string().trim().max(80).optional().default(''),
  primaryColor: z.string().trim().max(20).optional().default(''),
  accentColor: z.string().trim().max(20).optional().default(''),
  emailSenderName: z
    .string()
    .trim()
    .max(60)
    .refine((v) => !/[<>"\\\r\n]/.test(v), 'Use letters, numbers and simple punctuation only.')
    .optional()
    .default(''),
});

/** Checks branding text and colours. Blank means "use the platform default". */
export function checkBranding(input: { marketplaceName: string; primaryColor: string; accentColor: string; emailSenderName: string }) {
  const fieldErrors: Record<string, string> = {};
  let primary: string | null = null;
  let accent: string | null = null;
  if (input.primaryColor) {
    const c = checkMainColour(input.primaryColor);
    if (c.ok) primary = c.colour;
    else fieldErrors.primaryColor = c.message;
  }
  if (input.accentColor) {
    const c = checkAccentColour(input.accentColor);
    if (c.ok) accent = c.colour;
    else fieldErrors.accentColor = c.message;
  }
  return { fieldErrors, primary, accent };
}

export async function updateBranding(actor: UserActor, input: z.infer<typeof brandingSchema>) {
  await authorize(actor, 'show.branding.edit', { showId: input.showId }, { write: true });
  const { fieldErrors, primary, accent } = checkBranding(input);
  if (Object.keys(fieldErrors).length) throw invalid('Check the colours: they need to be easy to read.', fieldErrors);
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [show] = await tx.select().from(shows).where(eq(shows.id, input.showId)).for('update').limit(1);
    if (!show) throw notFound();
    const next: ShowBranding = {
      ...show.branding,
      marketplaceName: input.marketplaceName || null,
      primaryColor: primary,
      accentColor: accent,
      emailSenderName: input.emailSenderName || null,
    };
    await tx.update(shows).set({ branding: next }).where(eq(shows.id, show.id));
    await writeAudit(tx, actor, {
      action: 'show.branding_updated',
      summary: 'Changed the storefront’s name, colours or email sender name',
      entityType: 'show',
      entityId: show.id,
      showId: show.id,
      details: { before: pickText(show.branding), after: pickText(next) },
    });
  });
}

function pickText(b: ShowBranding) {
  return { marketplaceName: b.marketplaceName ?? null, primaryColor: b.primaryColor ?? null, accentColor: b.accentColor ?? null, emailSenderName: b.emailSenderName ?? null };
}

export const BRANDING_IMAGES = {
  logo: { field: 'logoFileId', label: 'logo', allowed: ['png', 'jpeg', 'svg'], maxBytes: 1024 * 1024 },
  logoLight: { field: 'logoLightFileId', label: 'light logo', allowed: ['png', 'jpeg', 'svg'], maxBytes: 1024 * 1024 },
  banner: { field: 'bannerFileId', label: 'banner', allowed: ['png', 'jpeg'], maxBytes: 5 * 1024 * 1024 },
  favicon: { field: 'faviconFileId', label: 'favicon', allowed: ['png'], maxBytes: 256 * 1024 },
} as const satisfies Record<string, { field: keyof ShowBranding; label: string; allowed: ImageKind[]; maxBytes: number }>;

export type BrandingImageSlot = keyof typeof BRANDING_IMAGES;

/** Uploads a logo, banner or favicon. It shows at once: every upload gets a new address. */
export async function setBrandingImage(actor: UserActor, showId: string, slot: BrandingImageSlot, file: { bytes: Uint8Array; name: string } | null) {
  await authorize(actor, 'show.branding.edit', { showId }, { write: true });
  const spec = BRANDING_IMAGES[slot];
  if (!spec) throw invalid('Choose which image to change.');
  const db = await getDb();
  // The file is checked and stored first (outside the transaction); a failed save leaves only an unused file.
  const stored = file
    ? await storeImage(actor, { bytes: file.bytes, name: file.name, purpose: 'branding', showId, isPublic: true, allowed: [...spec.allowed], maxBytes: spec.maxBytes })
    : null;
  await db.transaction(async (tx) => {
    const [show] = await tx.select().from(shows).where(eq(shows.id, showId)).for('update').limit(1);
    if (!show) throw notFound();
    await tx
      .update(shows)
      .set({ branding: { ...show.branding, [spec.field]: stored?.id ?? null } })
      .where(eq(shows.id, showId));
    await writeAudit(tx, actor, {
      action: stored ? 'show.branding_image_set' : 'show.branding_image_removed',
      summary: stored ? `Uploaded a new ${spec.label}` : `Removed the ${spec.label}`,
      entityType: 'show',
      entityId: showId,
      showId,
      details: { slot, fileId: stored?.id ?? null, previousFileId: show.branding[spec.field] ?? null },
    });
  });
  return stored;
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export async function listTeam(actor: Actor, showId: string) {
  await authorize(actor, 'show.view', { showId });
  const db = await getDb();
  const members = await db
    .select({ userId: users.id, name: users.name, email: users.email, role: showStaff.role, permissions: showStaff.permissions, twoFactor: users.totpEnabledAt })
    .from(showStaff)
    .innerJoin(users, eq(users.id, showStaff.userId))
    .where(eq(showStaff.showId, showId))
    .orderBy(asc(showStaff.role), asc(users.name));
  const pending = await db
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, permissions: invitations.permissions, expiresAt: invitations.expiresAt })
    .from(invitations)
    .where(and(eq(invitations.showId, showId), eq(invitations.kind, 'show_staff'), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())));
  return { members, pending };
}

export const teamMemberSchema = z.object({
  showId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(SHOW_ROLES),
  permissions: z.array(z.enum(SHOW_PERMISSIONS)).max(SHOW_PERMISSIONS.length).default([]),
});

export async function updateTeamMember(actor: UserActor, input: z.infer<typeof teamMemberSchema>) {
  await authorize(actor, 'show.team.manage', { showId: input.showId }, { write: true });
  if (input.userId === actor.userId && input.role !== 'show_admin' && !actor.isSuperAdmin) {
    throw invalid('You can’t remove your own admin rights. Ask another show admin.');
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(showStaff)
      .set({ role: input.role, permissions: input.role === 'show_admin' ? [] : (input.permissions as ShowPermission[]) })
      .where(and(eq(showStaff.showId, input.showId), eq(showStaff.userId, input.userId)))
      .returning();
    if (!row) throw notFound();
    await writeAudit(tx, actor, {
      action: 'show.team_member_updated',
      summary: input.role === 'show_admin' ? 'Made a team member a show admin' : `Set a team member’s rights to: ${input.permissions.join(', ') || 'view only'}`,
      entityType: 'user',
      entityId: input.userId,
      showId: input.showId,
      details: { role: input.role, permissions: input.permissions },
    });
  });
}

export async function removeTeamMember(actor: UserActor, showId: string, userId: string) {
  await authorize(actor, 'show.team.manage', { showId }, { write: true });
  if (userId === actor.userId && !actor.isSuperAdmin) throw invalid('You can’t remove yourself. Ask another show admin.');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(showStaff)
      .where(and(eq(showStaff.showId, showId), eq(showStaff.userId, userId)))
      .returning();
    if (!row) throw notFound();
    const admins = await tx.select({ id: showStaff.userId }).from(showStaff).where(and(eq(showStaff.showId, showId), eq(showStaff.role, 'show_admin')));
    if (row.role === 'show_admin' && !admins.length && !actor.isSuperAdmin) throw conflict('A show needs at least one show admin.');
    await writeAudit(tx, actor, { action: 'show.team_member_removed', summary: 'Removed someone from the show team', entityType: 'user', entityId: userId, showId });
  });
}

// ---------------------------------------------------------------------------
// The connection key for BluePrint and Billie
// ---------------------------------------------------------------------------

/** Makes the show's key, replacing any old one (which stops working at once). Returned once, to show once. */
export async function makeConnectionKey(actor: UserActor, showId: string): Promise<string> {
  await authorize(actor, 'show.connection.manage', { showId }, { write: true });
  const { key, keyId } = newConnectionKey();
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [show] = await tx.select({ keyId: shows.connectionKeyId }).from(shows).where(eq(shows.id, showId)).for('update').limit(1);
    if (!show) throw notFound();
    await tx
      .update(shows)
      .set({ connectionKeyId: keyId, connectionKeyHash: keyHashOf(key), connectionSigningKeyEnc: encryptSecret(signingKeyOf(key)), connectionKeyCreatedAt: new Date(), lastListSyncAt: null, lastLinkSignInAt: null })
      .where(eq(shows.id, showId));
    await writeAudit(tx, actor, {
      action: 'show.connection_key_created',
      summary: show.keyId ? 'Made a new BluePrint key (the old one stopped working)' : 'Made a BluePrint key for this show',
      entityType: 'show',
      entityId: showId,
      showId,
      details: { keyId },
    });
  });
  return key;
}

export async function removeConnectionKey(actor: UserActor, showId: string) {
  await authorize(actor, 'show.connection.manage', { showId }, { write: true });
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.update(shows).set({ connectionKeyId: null, connectionKeyHash: null, connectionSigningKeyEnc: null, connectionKeyCreatedAt: null }).where(eq(shows.id, showId));
    await writeAudit(tx, actor, { action: 'show.connection_key_removed', summary: 'Removed the BluePrint key: it stopped working', entityType: 'show', entityId: showId, showId });
  });
}
