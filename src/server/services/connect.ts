import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, type DbLike } from '../db/client';
import { stripeEvents, suppliers } from '../db/schema';
import { authorize } from '../authz';
import { invalid, notFound } from '../errors';
import { writeAudit } from '../audit';
import { appUrl } from '../auth/login';
import { systemActor, type Actor, type UserActor } from '../auth/actor';
import { flagsFromAccount, payments, simulatorActive, type AccountFlags, type StripeEventLite } from '../payments/provider';

/**
 * Suppliers connecting their own Stripe account (Stripe Connect). The supplier presses "Connect
 * with Stripe", we make their connected account once and send them to Stripe's own set-up pages.
 * We keep only the `acct_…` id and three flags; Stripe keeps their business and bank details.
 * A supplier is Ready to sell once Stripe says `charges_enabled`.
 */

export type ConnectView = {
  /** Null when payments are off (a live site with no Stripe key yet). */
  mode: 'stripe' | 'simulator' | null;
  testMode: boolean;
  connected: boolean;
  flags: AccountFlags;
  dashboardUrl: string | null;
  checkedAt: Date | null;
};

const ACCT = /^acct_[A-Za-z0-9]{6,64}$/;

async function supplierRow(supplierId: string, db?: DbLike) {
  if (!/^[0-9a-f-]{36}$/i.test(supplierId)) throw notFound();
  const d = db ?? (await getDb());
  const [row] = await d.select().from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!row) throw notFound();
  return row;
}

function viewOf(row: typeof suppliers.$inferSelect): ConnectView {
  const p = payments();
  return {
    mode: p?.kind ?? null,
    testMode: p?.testMode ?? false,
    connected: Boolean(row.stripeAccountId),
    flags: { chargesEnabled: row.stripeChargesEnabled, payoutsEnabled: row.stripePayoutsEnabled, detailsSubmitted: row.stripeDetailsSubmitted },
    dashboardUrl: row.stripeAccountId ? (p?.dashboardUrl() ?? null) : null,
    checkedAt: row.stripeCheckedAt,
  };
}

/** For the supplier's Payments page. */
export async function connectViewForMember(actor: Actor, supplierId: string) {
  await authorize(actor, 'supplier.view', { supplierId });
  return viewOf(await supplierRow(supplierId));
}

/** For Media10's page about the supplier. */
export async function connectViewForAdmin(actor: Actor, supplierId: string) {
  await authorize(actor, 'suppliers.view');
  return viewOf(await supplierRow(supplierId));
}

/**
 * Saves what Stripe says about an account. `at` is when Stripe said it, so an older webhook that
 * arrives late never undoes a newer answer. Records a line in the audit log when the supplier
 * becomes able, or stops being able, to take payments.
 */
export async function applyAccountFlags(tx: DbLike, actor: Actor, supplierId: string, flags: AccountFlags, at: Date) {
  const [row] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).for('update').limit(1);
  if (!row) throw notFound();
  if (row.stripeCheckedAt && row.stripeCheckedAt > at) return { changed: false, stale: true };
  await tx
    .update(suppliers)
    .set({ stripeChargesEnabled: flags.chargesEnabled, stripePayoutsEnabled: flags.payoutsEnabled, stripeDetailsSubmitted: flags.detailsSubmitted, stripeCheckedAt: at })
    .where(eq(suppliers.id, supplierId));
  const changed = row.stripeChargesEnabled !== flags.chargesEnabled || row.stripePayoutsEnabled !== flags.payoutsEnabled || row.stripeDetailsSubmitted !== flags.detailsSubmitted;
  if (row.stripeChargesEnabled !== flags.chargesEnabled) {
    await writeAudit(tx, actor, {
      action: flags.chargesEnabled ? 'supplier.stripe_ready' : 'supplier.stripe_not_ready',
      summary: flags.chargesEnabled ? `Stripe can now take payments for ${row.name}` : `Stripe has stopped taking payments for ${row.name}`,
      entityType: 'supplier',
      entityId: supplierId,
      supplierId,
      details: flags,
    });
  }
  return { changed, stale: false };
}

/**
 * "Connect with Stripe": makes the supplier's connected account the first time, then returns a
 * fresh link to Stripe's set-up pages. Owners only. Media10's own services never connect.
 */
export async function startStripeOnboarding(actor: UserActor, supplierId: string): Promise<string> {
  await authorize(actor, 'supplier.manage', { supplierId }, { write: true });
  const p = payments();
  if (!p) throw invalid('Card payments aren’t switched on yet, so you can’t connect Stripe today. Media10 will tell you when you can.');
  let row = await supplierRow(supplierId);
  if (row.kind === 'organiser') throw invalid('Media10’s own services are paid into Media10’s own Stripe account, so there is nothing to connect.');
  if (!row.stripeAccountId) {
    // The idempotency key means two quick presses (or a retry) make one account, not two.
    const { id } = await p.createConnectedAccount({ email: row.email, businessName: row.name, supplierId, idempotencyKey: `connect-account:${supplierId}` });
    if (!ACCT.test(id)) throw new Error('Stripe returned an unexpected account id');
    const db = await getDb();
    row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(suppliers).where(eq(suppliers.id, supplierId)).for('update').limit(1);
      if (current.stripeAccountId) return current;
      const [saved] = await tx.update(suppliers).set({ stripeAccountId: id }).where(eq(suppliers.id, supplierId)).returning();
      await writeAudit(tx, actor, { action: 'supplier.stripe_connected', summary: `Started connecting ${row.name} to Stripe`, entityType: 'supplier', entityId: supplierId, supplierId, details: { account: id } });
      return saved;
    });
  }
  const base = `/supplier/${supplierId}/payments`;
  return p.onboardingLink(row.stripeAccountId!, appUrl(`${base}?stripe=return`), appUrl(`${base}/stripe`));
}

/**
 * For the link Stripe sends people back to when a set-up link has expired: a new link for an
 * account already made. Never makes an account (it's reached by a plain link).
 */
export async function resumeStripeOnboarding(actor: UserActor, supplierId: string): Promise<string | null> {
  await authorize(actor, 'supplier.manage', { supplierId });
  const p = payments();
  const row = await supplierRow(supplierId);
  if (!p || !row.stripeAccountId || row.kind === 'organiser') return null;
  const base = `/supplier/${supplierId}/payments`;
  return p.onboardingLink(row.stripeAccountId, appUrl(`${base}?stripe=return`), appUrl(`${base}/stripe`));
}

/**
 * "Check status": asks Stripe now, rather than waiting for its webhook. The supplier's people use
 * `supplier.view`; Media10 uses `suppliers.manage` from the supplier's admin page.
 */
export async function checkStripeStatus(actor: UserActor, supplierId: string, via: 'supplier.view' | 'suppliers.manage') {
  await authorize(actor, via, via === 'supplier.view' ? { supplierId } : {}, { write: true });
  const p = payments();
  const row = await supplierRow(supplierId);
  if (!p || !row.stripeAccountId) return viewOf(row);
  const flags = await p.accountStatus(row.stripeAccountId);
  if (!flags) return viewOf(row);
  const db = await getDb();
  await db.transaction((tx) => applyAccountFlags(tx, actor, supplierId, flags, new Date()));
  return viewOf(await supplierRow(supplierId));
}

/** The local simulator's stand-in for finishing Stripe's set-up. Never available on a live site. */
export async function finishSimulatedOnboarding(actor: UserActor, accountId: string) {
  if (!simulatorActive()) throw notFound();
  if (!/^acct_sim[a-z0-9]{1,40}$/.test(accountId)) throw notFound();
  const db = await getDb();
  const [row] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.stripeAccountId, accountId)).limit(1);
  if (!row) throw notFound();
  await authorize(actor, 'supplier.manage', { supplierId: row.id }, { write: true });
  await db.transaction((tx) => applyAccountFlags(tx, actor, row.id, { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true }, new Date()));
  return row.id;
}

/** Which supplier a simulator account belongs to, for its stand-in page. */
export async function simulatedAccountSupplier(actor: UserActor, accountId: string) {
  if (!simulatorActive() || !/^acct_sim[a-z0-9]{1,40}$/.test(accountId)) throw notFound();
  const db = await getDb();
  const [row] = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.stripeAccountId, accountId)).limit(1);
  if (!row) throw notFound();
  await authorize(actor, 'supplier.manage', { supplierId: row.id });
  return row;
}

/**
 * Applies one event from the Connect webhook, exactly once: the event id is recorded in the same
 * transaction as the change, so a resent event finds it and does nothing.
 */
export async function handleConnectEvent(event: StripeEventLite): Promise<'applied' | 'duplicate' | 'ignored'> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [fresh] = await tx
      .insert(stripeEvents)
      .values({ id: event.id, endpoint: 'connect', type: event.type, account: event.account })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (!fresh) return 'duplicate';
    if (event.type !== 'account.updated') return 'ignored';
    const account = event.account ?? (typeof event.object.id === 'string' ? event.object.id : null);
    if (!account) return 'ignored';
    const [row] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.stripeAccountId, account)).limit(1);
    if (!row) return 'ignored';
    await applyAccountFlags(tx, systemActor('Stripe webhook'), row.id, flagsFromAccount(event.object as Parameters<typeof flagsFromAccount>[0]), new Date(event.created * 1000));
    return 'applied';
  });
}
