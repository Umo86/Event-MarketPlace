import 'server-only';
import { randomInt } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/client';
import { supplierUsers, suppliers, users } from '../db/schema';
import { authorize, supplierIdsFor } from '../authz';
import { conflict, invalid, notFound } from '../errors';
import { writeAudit } from '../audit';
import { hashPassword } from '../security/password';
import { revokeAllSessions } from '../auth/sessions';
import { appUrl } from '../auth/login';
import { supplierStatus, type SupplierStatus } from '@/lib/supplier-status';
export { suggestPrefix } from '@/lib/supplier-status';
import type { Actor, UserActor } from '../auth/actor';

/**
 * Suppliers and their logins. A super admin adds a supplier and its first login, and passes the
 * login details on themselves: nothing is emailed (Umit's choice, 9 November 2026). The password is
 * shown once and must be changed at the first sign-in.
 */

export type SupplierRow = typeof suppliers.$inferSelect;

// No 0/O, 1/l/I: the password is read out or typed from a message.
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A one-off password that is easy to pass on: four groups of four, e.g. "Kp7x-Qm3z-Wd9r-Hs2v". */
export function temporaryPassword(): string {
  const group = () => Array.from({ length: 4 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
  return [group(), group(), group(), group()].join('-');
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

export const supplierDetailsSchema = z.object({
  name: z.string().trim().min(2, 'Enter the company name.').max(160),
  contactName: z.string().trim().min(2, 'Enter the main contact’s name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  phone: text(40),
  addressLine1: text(160),
  addressLine2: text(160),
  city: text(80),
  postcode: text(20),
  vatRegistered: z.boolean(),
  vatNumber: text(30),
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, 'Use 2 to 6 capital letters or numbers, such as SPK.'),
});

export const createSupplierSchema = supplierDetailsSchema;
/** The login email can't be changed here: it belongs to the person's account. */
export const updateSupplierSchema = supplierDetailsSchema.omit({ email: true });

export type NewLogin = { email: string; name: string; password: string | null; signInUrl: string; existingAccount: boolean };

/**
 * Adds a supplier and its owner login. A new login gets a one-off password, returned once to show
 * on screen. If the email already has an account, it's linked and keeps its own password.
 */
export async function createSupplier(actor: UserActor, raw: z.input<typeof createSupplierSchema>) {
  const input = createSupplierSchema.parse(raw);
  await authorize(actor, 'suppliers.manage', {}, { write: true });
  const password = temporaryPassword();
  const hash = await hashPassword(password);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [prefixTaken] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(sql`upper(${suppliers.invoicePrefix}) = ${input.invoicePrefix}`)
      .limit(1);
    if (prefixTaken) throw invalid('Another supplier already uses that invoice prefix.', { invoicePrefix: 'Another supplier already uses that prefix. Choose another.' });
    const [supplier] = await tx
      .insert(suppliers)
      .values({ ...input, vatNumber: input.vatRegistered ? input.vatNumber : null, createdBy: actor.userId })
      .returning();
    let [user] = await tx.select().from(users).where(eq(users.email, input.email)).limit(1);
    const existingAccount = Boolean(user);
    if (user?.status === 'disabled') throw conflict('That email belongs to an account that has been switched off. Use another email, or ask a super admin to switch it back on.');
    if (!user) {
      [user] = await tx.insert(users).values({ email: input.email, name: input.contactName, status: 'active', passwordHash: hash, mustChangePassword: true }).returning();
    }
    await tx.insert(supplierUsers).values({ supplierId: supplier.id, userId: user.id, role: 'owner', canRefund: true, canEditCatalogue: true, addedBy: actor.userId });
    await writeAudit(tx, actor, {
      action: 'supplier.created',
      summary: `Added the supplier ${supplier.name}${existingAccount ? `, linked to the existing account ${input.email}` : `, with a login for ${input.email}`}`,
      entityType: 'supplier',
      entityId: supplier.id,
      supplierId: supplier.id,
      details: { email: input.email, newLogin: !existingAccount },
    });
    const login: NewLogin = { email: input.email, name: user.name || input.contactName, password: existingAccount ? null : password, signInUrl: appUrl('/sign-in'), existingAccount };
    return { supplier, login };
  });
}

/**
 * Media10 as its own supplier, for its own services (stand cleaning and the like). Charged on
 * Media10's own Stripe account, so it never connects one, and no supplier login is made: Media10
 * staff look after it. There is at most one.
 */
export async function createOrganiserSupplier(actor: UserActor, raw: z.input<typeof createSupplierSchema>) {
  const input = createSupplierSchema.parse(raw);
  await authorize(actor, 'suppliers.manage', {}, { write: true });
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.kind, 'organiser')).limit(1);
    if (existing) throw conflict('Media10’s own services are already set up. Open them from the suppliers list.');
    const [prefixTaken] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(sql`upper(${suppliers.invoicePrefix}) = ${input.invoicePrefix}`)
      .limit(1);
    if (prefixTaken) throw invalid('Another supplier already uses that invoice prefix.', { invoicePrefix: 'Another supplier already uses that prefix. Choose another.' });
    const [supplier] = await tx
      .insert(suppliers)
      .values({ ...input, kind: 'organiser', vatNumber: input.vatRegistered ? input.vatNumber : null, createdBy: actor.userId })
      .returning();
    await writeAudit(tx, actor, {
      action: 'supplier.created',
      summary: `Set up ${supplier.name} as the supplier for Media10’s own services`,
      entityType: 'supplier',
      entityId: supplier.id,
      supplierId: supplier.id,
      details: { kind: 'organiser' },
    });
    return supplier;
  });
}

export async function hasOrganiserSupplier() {
  const db = await getDb();
  const [row] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.kind, 'organiser')).limit(1);
  return Boolean(row);
}

export async function updateSupplier(actor: UserActor, supplierId: string, raw: z.input<typeof updateSupplierSchema>) {
  const input = updateSupplierSchema.parse(raw);
  await authorize(actor, 'suppliers.manage', {}, { write: true });
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(sql`upper(${suppliers.invoicePrefix}) = ${input.invoicePrefix}`, sql`${suppliers.id} <> ${supplierId}`))
      .limit(1);
    if (taken) throw invalid('Another supplier already uses that invoice prefix.', { invoicePrefix: 'Another supplier already uses that prefix. Choose another.' });
    const [row] = await tx
      .update(suppliers)
      .set({ ...input, vatNumber: input.vatRegistered ? input.vatNumber : null })
      .where(eq(suppliers.id, supplierId))
      .returning();
    if (!row) throw notFound();
    await writeAudit(tx, actor, { action: 'supplier.updated', summary: `Changed ${row.name}’s details`, entityType: 'supplier', entityId: supplierId, supplierId });
  });
}

/**
 * A new one-off password for one of the supplier's logins, for when they've lost theirs. Signs them
 * out everywhere; they choose their own password at the next sign-in.
 */
export async function resetSupplierLogin(actor: UserActor, supplierId: string, userId: string) {
  await authorize(actor, 'suppliers.manage', {}, { write: true });
  const db = await getDb();
  const password = temporaryPassword();
  const hash = await hashPassword(password);
  const login = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ user: users, supplierName: suppliers.name })
      .from(supplierUsers)
      .innerJoin(users, eq(users.id, supplierUsers.userId))
      .innerJoin(suppliers, eq(suppliers.id, supplierUsers.supplierId))
      .where(and(eq(supplierUsers.supplierId, supplierId), eq(supplierUsers.userId, userId)))
      .limit(1);
    if (!row) throw notFound();
    // Never reset a Media10 account from here: staff look after their own logins.
    if (row.user.isSuperAdmin) throw invalid('That login is a Media10 super admin. They reset their own password.');
    await tx.update(users).set({ passwordHash: hash, mustChangePassword: true, failedPasswordAttempts: 0, lockedUntil: null }).where(eq(users.id, userId));
    await writeAudit(tx, actor, {
      action: 'supplier.login_reset',
      summary: `Made a new one-off password for ${row.user.email} at ${row.supplierName}`,
      entityType: 'user',
      entityId: userId,
      supplierId,
    });
    return { email: row.user.email, name: row.user.name, password, signInUrl: appUrl('/sign-in'), existingAccount: true } satisfies NewLogin;
  });
  await revokeAllSessions(userId);
  return login;
}

export async function setSupplierPaused(actor: UserActor, supplierId: string, pause: { paused: boolean; reason?: string | null }) {
  await authorize(actor, 'suppliers.manage', {}, { write: true });
  const reason = pause.reason?.trim() || null;
  if (pause.paused && !reason) throw invalid('Say why you’re pausing them. They’ll see this.', { reason: 'Give a reason.' });
  const db = await getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(suppliers)
      .set(pause.paused ? { pausedAt: new Date(), pausedReason: reason } : { pausedAt: null, pausedReason: null })
      .where(eq(suppliers.id, supplierId))
      .returning();
    if (!row) throw notFound();
    await writeAudit(tx, actor, {
      action: pause.paused ? 'supplier.paused' : 'supplier.resumed',
      summary: pause.paused ? `Paused ${row.name}: ${reason}` : `Took ${row.name} off pause`,
      entityType: 'supplier',
      entityId: supplierId,
      supplierId,
    });
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async function statusesFor(rows: SupplierRow[]) {
  if (!rows.length) return new Map<string, SupplierStatus>();
  const db = await getDb();
  const signedIn = await db
    .selectDistinct({ supplierId: supplierUsers.supplierId })
    .from(supplierUsers)
    .innerJoin(users, eq(users.id, supplierUsers.userId))
    .where(
      and(
        inArray(
          supplierUsers.supplierId,
          rows.map((r) => r.id),
        ),
        isNotNull(users.lastLoginAt),
      ),
    );
  const seen = new Set(signedIn.map((r) => r.supplierId));
  return new Map(rows.map((r) => [r.id, supplierStatus({ kind: r.kind, pausedAt: r.pausedAt, stripeChargesEnabled: r.stripeChargesEnabled, anyoneSignedIn: seen.has(r.id) })]));
}

export async function listSuppliers(actor: Actor) {
  await authorize(actor, 'suppliers.view');
  const db = await getDb();
  const rows = await db.select().from(suppliers).orderBy(asc(suppliers.name));
  const status = await statusesFor(rows);
  return rows.map((r) => ({ ...r, status: status.get(r.id)! }));
}

async function members(supplierId: string) {
  const db = await getDb();
  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: supplierUsers.role,
      canRefund: supplierUsers.canRefund,
      canEditCatalogue: supplierUsers.canEditCatalogue,
      lastLoginAt: users.lastLoginAt,
      mustChangePassword: users.mustChangePassword,
      twoFactor: users.totpEnabledAt,
    })
    .from(supplierUsers)
    .innerJoin(users, eq(users.id, supplierUsers.userId))
    .where(eq(supplierUsers.supplierId, supplierId))
    .orderBy(asc(supplierUsers.role), asc(users.name));
}

export async function getSupplierForAdmin(actor: Actor, supplierId: string) {
  await authorize(actor, 'suppliers.view');
  if (!/^[0-9a-f-]{36}$/i.test(supplierId)) throw notFound();
  const db = await getDb();
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!row) throw notFound();
  const status = (await statusesFor([row])).get(row.id)!;
  return { supplier: { ...row, status }, members: await members(row.id) };
}

/** The suppliers someone signs in for, for the supplier panel. */
export async function mySuppliers(actor: Actor) {
  const ids = await supplierIdsFor(actor);
  if (!ids.length) return [];
  const db = await getDb();
  const rows = await db.select().from(suppliers).where(inArray(suppliers.id, ids)).orderBy(asc(suppliers.name));
  const status = await statusesFor(rows);
  return rows.map((r) => ({ ...r, status: status.get(r.id)! }));
}

export async function getSupplierForMember(actor: Actor, supplierId: string) {
  const grant = await authorize(actor, 'supplier.view', { supplierId });
  const db = await getDb();
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!row) throw notFound();
  const status = (await statusesFor([row])).get(row.id)!;
  return { supplier: { ...row, status }, role: grant.supplierRole!, members: await members(row.id) };
}

