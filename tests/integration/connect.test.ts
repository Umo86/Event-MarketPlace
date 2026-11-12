import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { getDb, useInMemoryDatabaseForTests } from '@/server/db/client';
import { auditLog, stripeEvents, suppliers } from '@/server/db/schema';
import { checkStripeStatus, finishSimulatedOnboarding, handleConnectEvent, startStripeOnboarding } from '@/server/services/connect';
import { createOrganiserSupplier, getSupplierForAdmin } from '@/server/services/suppliers';
import { setPaymentsForTests, SimulatedPayments, type AccountFlags, type PaymentsProvider } from '@/server/payments/provider';
import { receiveStripeWebhook } from '@/server/payments/webhook';
import { resetEnvCache } from '@/server/env';
import { actorFor, makeSupplier, makeUser } from '../support/factories';
import { supplierUsers } from '@/server/db/schema';

beforeAll(async () => {
  await useInMemoryDatabaseForTests();
});

afterEach(() => {
  setPaymentsForTests(undefined);
});

/** Stands in for Stripe in these tests and records what was asked of it. */
class FakeStripe {
  kind = 'stripe' as const;
  testMode = true;
  created: { idempotencyKey: string; email: string }[] = [];
  links: { account: string; returnUrl: string; refreshUrl: string }[] = [];
  status: AccountFlags = { chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false };
  async createConnectedAccount(input: { email: string; businessName: string; supplierId: string; idempotencyKey: string }) {
    this.created.push(input);
    return { id: `acct_test${input.supplierId.replace(/-/g, '').slice(0, 12)}` };
  }
  async onboardingLink(account: string, returnUrl: string, refreshUrl: string) {
    this.links.push({ account, returnUrl, refreshUrl });
    return `https://connect.stripe.com/setup/e/${account}/abc`;
  }
  async accountStatus() {
    return this.status;
  }
  dashboardUrl() {
    return 'https://dashboard.stripe.com/';
  }
  async verifyWebhook(): Promise<never> {
    throw new Error('not used');
  }
}

const readRow = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  return row;
};

describe('connecting a supplier to Stripe', () => {
  it('makes one connected account, sends the owner to Stripe, and is Ready to sell once Stripe says so', async () => {
    const fake = new FakeStripe();
    setPaymentsForTests(fake as unknown as PaymentsProvider);
    const { supplier, owner, admin } = await makeSupplier();
    const url = await startStripeOnboarding(owner, supplier.id);
    expect(url).toMatch(/^https:\/\/connect\.stripe\.com\//);
    expect(fake.links[0]).toMatchObject({ returnUrl: `http://localhost:3000/supplier/${supplier.id}/payments?stripe=return`, refreshUrl: `http://localhost:3000/supplier/${supplier.id}/payments/stripe` });
    // Pressing again reuses the account.
    await startStripeOnboarding(owner, supplier.id);
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0].idempotencyKey).toBe(`connect-account:${supplier.id}`);
    const saved = await readRow(supplier.id);
    expect(saved.stripeAccountId).toMatch(/^acct_test/);
    expect(saved.stripeChargesEnabled).toBe(false);

    fake.status = { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true };
    const view = await checkStripeStatus(owner, supplier.id, 'supplier.view');
    expect(view.flags.chargesEnabled).toBe(true);
    expect((await getSupplierForAdmin(admin, supplier.id)).supplier.status).toBe('ready');
    const db = await getDb();
    const audit = await db.select().from(auditLog).where(eq(auditLog.supplierId, supplier.id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['supplier.stripe_connected', 'supplier.stripe_ready']));
  });

  it('is for the supplier’s owner only, and never for Media10’s own services', async () => {
    setPaymentsForTests(new FakeStripe() as unknown as PaymentsProvider);
    const { supplier, admin } = await makeSupplier();
    const staff = await makeUser();
    const db = await getDb();
    await db.insert(supplierUsers).values({ supplierId: supplier.id, userId: staff.id, role: 'staff' });
    await expect(startStripeOnboarding(actorFor(staff), supplier.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(startStripeOnboarding(await makeUser().then(actorFor), supplier.id)).rejects.toMatchObject({ code: 'not_found' });
    // Staff may still check the status.
    await expect(checkStripeStatus(actorFor(staff), supplier.id, 'supplier.view')).resolves.toMatchObject({ connected: false });
    const organiser = await createOrganiserSupplier(admin, { name: 'Media10 Ltd', contactName: 'Ops', email: 'ops@media10.example.com', vatRegistered: true, invoicePrefix: 'MTEN' });
    expect((await getSupplierForAdmin(admin, organiser.id)).supplier.status).toBe('ready');
    await expect(createOrganiserSupplier(admin, { name: 'Again', contactName: 'Ops', email: 'ops2@media10.example.com', vatRegistered: true, invoicePrefix: 'MTWO' })).rejects.toThrow(/already set up/);
  });

  it('says payments are off when there is no Stripe and no simulator (a live site without keys)', async () => {
    setPaymentsForTests(null);
    const { supplier, owner } = await makeSupplier();
    await expect(startStripeOnboarding(owner, supplier.id)).rejects.toThrow(/aren’t switched on yet/);
  });

  it('works end to end with the local simulator', async () => {
    const sim = new SimulatedPayments();
    setPaymentsForTests(sim);
    const { supplier, owner, admin } = await makeSupplier();
    const url = await startStripeOnboarding(owner, supplier.id);
    expect(url).toMatch(/^\/supplier\/test-onboarding\?account=acct_sim/);
    const account = decodeURIComponent(url.split('account=')[1]);
    // Someone from another supplier can't finish it.
    const other = await makeSupplier();
    await expect(finishSimulatedOnboarding(other.owner, account)).rejects.toMatchObject({ code: 'not_found' });
    await finishSimulatedOnboarding(owner, account);
    expect((await getSupplierForAdmin(admin, supplier.id)).supplier.status).toBe('ready');
  });

  it('never runs the simulator’s finish step when Stripe is in use', async () => {
    setPaymentsForTests(new FakeStripe() as unknown as PaymentsProvider);
    const { owner } = await makeSupplier();
    await expect(finishSimulatedOnboarding(owner, 'acct_simabc123')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the Connect webhook', () => {
  const secret = 'whsec_test_connect_secret_for_tests_only';

  async function withStripeKey<T>(fn: () => Promise<T>) {
    const before = { key: process.env.STRIPE_SECRET_KEY, wh: process.env.STRIPE_CONNECT_WEBHOOK_SECRET };
    process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key';
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = secret;
    resetEnvCache();
    setPaymentsForTests(undefined);
    try {
      return await fn();
    } finally {
      if (before.key === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = before.key;
      if (before.wh === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
      else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = before.wh;
      resetEnvCache();
      setPaymentsForTests(undefined);
    }
  }

  function signed(payload: Record<string, unknown>, opts: { timestamp?: number; secret?: string } = {}) {
    const body = JSON.stringify(payload);
    const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: opts.secret ?? secret, timestamp: opts.timestamp });
    return new Request('http://localhost:3000/api/webhooks/stripe/connect', { method: 'POST', body, headers: { 'stripe-signature': header, 'content-type': 'application/json' } });
  }

  const accountUpdated = (id: string, account: string, charges: boolean, created = Math.floor(Date.now() / 1000)) => ({
    id,
    object: 'event',
    type: 'account.updated',
    created,
    account,
    data: { object: { id: account, object: 'account', charges_enabled: charges, payouts_enabled: charges, details_submitted: true } },
  });

  it('applies account.updated once, checking the signature and its age', async () => {
    const { supplier, admin } = await makeSupplier();
    const db = await getDb();
    await db.update(suppliers).set({ stripeAccountId: 'acct_webhook0001' }).where(eq(suppliers.id, supplier.id));
    await withStripeKey(async () => {
      // Wrong secret, then too old: both refused, nothing changes.
      expect((await receiveStripeWebhook(signed(accountUpdated('evt_bad', 'acct_webhook0001', true), { secret: 'whsec_wrong' }), 'connect')).status).toBe(400);
      expect((await receiveStripeWebhook(signed(accountUpdated('evt_old', 'acct_webhook0001', true), { timestamp: Math.floor(Date.now() / 1000) - 600 }), 'connect')).status).toBe(400);
      expect((await readRow(supplier.id)).stripeChargesEnabled).toBe(false);

      const res = await receiveStripeWebhook(signed(accountUpdated('evt_1', 'acct_webhook0001', true)), 'connect');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ result: 'applied' });
      expect((await getSupplierForAdmin(admin, supplier.id)).supplier.status).toBe('ready');
      const again = await receiveStripeWebhook(signed(accountUpdated('evt_1', 'acct_webhook0001', true)), 'connect');
      expect(await again.json()).toMatchObject({ result: 'duplicate' });
    });
    expect(await db.select().from(stripeEvents).where(eq(stripeEvents.id, 'evt_1'))).toHaveLength(1);
  });

  it('never lets an older event undo a newer answer', async () => {
    const { supplier } = await makeSupplier();
    const db = await getDb();
    await db.update(suppliers).set({ stripeAccountId: 'acct_webhook0002' }).where(eq(suppliers.id, supplier.id));
    const now = Math.floor(Date.now() / 1000);
    await handleConnectEvent({ id: 'evt_new', type: 'account.updated', created: now, account: 'acct_webhook0002', object: { charges_enabled: true, payouts_enabled: true, details_submitted: true } });
    await handleConnectEvent({ id: 'evt_older', type: 'account.updated', created: now - 120, account: 'acct_webhook0002', object: { charges_enabled: false, payouts_enabled: false, details_submitted: true } });
    expect((await readRow(supplier.id)).stripeChargesEnabled).toBe(true);
  });

  it('isn’t there at all without a Stripe key', async () => {
    setPaymentsForTests(new SimulatedPayments());
    const res = await receiveStripeWebhook(new Request('http://localhost/api/webhooks/stripe/connect', { method: 'POST', body: '{}' }), 'connect');
    expect(res.status).toBe(404);
  });
});
