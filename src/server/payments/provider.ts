import 'server-only';
import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { env, liveSite } from '../env';

/**
 * Stripe, or the local payment simulator. Phase 1 needs only the Connect parts: making a supplier's
 * connected account, sending them to Stripe's own set-up pages, reading what Stripe says about the
 * account, and checking webhook signatures. Charges and refunds arrive in phase 2.
 *
 * We never ask a supplier for API keys (DECISIONS.md, decision 5). We keep only the `acct_…` id and
 * the three flags Stripe reports.
 */

export type AccountFlags = { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean };

/** The parts of a Stripe event we use. */
export type StripeEventLite = { id: string; type: string; created: number; account: string | null; object: Record<string, unknown> };

export interface PaymentsProvider {
  kind: 'stripe' | 'simulator';
  /** Test keys or the simulator: no real money can move. */
  testMode: boolean;
  createConnectedAccount(input: { email: string; businessName: string; supplierId: string; idempotencyKey: string }): Promise<{ id: string }>;
  onboardingLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string>;
  /** What Stripe says now, or null when there's nothing to ask (the simulator keeps its answer in our database). */
  accountStatus(accountId: string): Promise<AccountFlags | null>;
  /** Where the supplier manages their own Stripe account. */
  dashboardUrl(): string | null;
  /** Checks the signature over the exact bytes Stripe sent and refuses anything older than five minutes. */
  verifyWebhook(rawBody: string, signature: string | null, endpoint: 'platform' | 'connect'): Promise<StripeEventLite>;

  // Checkout (all on Media10's own account): a customer and a SetupIntent to save the card once.
  createCustomer(input: { email: string; name: string; orderId: string; idempotencyKey: string }): Promise<{ id: string }>;
  createSetupIntent(input: { customerId: string; orderId: string; idempotencyKey: string }): Promise<{ id: string; clientSecret: string | null }>;
  setupIntentStatus(id: string): Promise<{ status: 'succeeded' | 'processing' | 'requires_action' | 'failed'; paymentMethodId: string | null; customerId: string | null }>;
  /**
   * One supplier order's charge. With `account`, a direct charge on the supplier's account with
   * Media10's commission as the application fee (the saved card is copied there first); without, a
   * plain charge on Media10's own account. Never throws for a declined card: it says so.
   */
  charge(input: ChargeInput): Promise<ChargeResult>;
  refund(input: { account: string | null; paymentIntentId: string; amountPence: number; refundApplicationFee: boolean; idempotencyKey: string; metadata: Record<string, string> }): Promise<{ id: string; status: 'succeeded' | 'pending' | 'failed'; feeRefundedPence: number | null }>;
  /** Every refund Stripe has on a payment (to pick up refunds made in the supplier's own Stripe dashboard). */
  listRefunds(account: string | null, paymentIntentId: string): Promise<{ id: string; amountPence: number; status: 'succeeded' | 'pending' | 'failed'; created: number }[]>;
  /** For the browser's Payment Element; null with the simulator. */
  publishableKey(): string | null;
}

export type ChargeInput = {
  account: string | null;
  customerId: string;
  paymentMethodId: string;
  amountPence: number;
  feePence: number;
  description: string;
  statementSuffix: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
};

export type ChargeResult =
  | { status: 'succeeded'; paymentIntentId: string; chargeId: string | null }
  | { status: 'processing'; paymentIntentId: string }
  | { status: 'failed'; paymentIntentId: string | null; message: string; needsAuthentication: boolean };

/** Plain words for a declined card (Stripe's own messages are already written for card holders). */
function declineMessage(err: { code?: string; decline_code?: string; message?: string }): string {
  if (err.code === 'authentication_required') return 'Your bank wants you to confirm this payment. Press Pay and follow your bank’s steps.';
  if (err.code === 'card_declined' || err.decline_code) return err.message ?? 'Your card was declined. Try another card.';
  if (err.code === 'expired_card') return 'Your card has expired. Try another card.';
  return err.message ?? 'The payment didn’t go through. Try again or use another card.';
}

export class WebhookSignatureError extends Error {}

/** Five minutes, the window the brief sets for webhook signatures. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function flagsFromAccount(a: { charges_enabled?: boolean | null; payouts_enabled?: boolean | null; details_submitted?: boolean | null }): AccountFlags {
  return { chargesEnabled: Boolean(a.charges_enabled), payoutsEnabled: Boolean(a.payouts_enabled), detailsSubmitted: Boolean(a.details_submitted) };
}

function isV2Blocked(err: unknown) {
  const e = err as { code?: string; raw?: { code?: string } } | null;
  return e?.code === 'accounts_v2_access_blocked' || e?.raw?.code === 'accounts_v2_access_blocked';
}

class StripeProvider implements PaymentsProvider {
  kind = 'stripe' as const;
  testMode: boolean;
  private client: Promise<Stripe> | null = null;
  /** Set once Stripe says this platform can't use Accounts v2 yet; then we use v1 throughout. */
  private v1Only = false;

  constructor(private readonly key: string) {
    this.testMode = /^(sk|rk)_test_/.test(key);
  }

  private stripe(): Promise<Stripe> {
    this.client ??= import('stripe').then(({ default: S }) => new S(this.key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'Event MarketPlace' } }));
    return this.client;
  }

  async createConnectedAccount(input: { email: string; businessName: string; supplierId: string; idempotencyKey: string }) {
    const s = await this.stripe();
    if (!this.v1Only) {
      try {
        // Accounts v2, as Stripe now recommends: the supplier uses the full Stripe dashboard, pays
        // Stripe's fees itself and Stripe covers losses, which suits direct charges.
        const a = await s.v2.core.accounts.create(
          {
            contact_email: input.email,
            display_name: input.businessName.slice(0, 100),
            dashboard: 'full',
            identity: { country: 'gb' },
            configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
            defaults: { currency: 'gbp', responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
            metadata: { supplierId: input.supplierId },
          },
          { idempotencyKey: `${input.idempotencyKey}:v2` },
        );
        return { id: a.id };
      } catch (err) {
        if (!isV2Blocked(err)) throw err;
        this.v1Only = true;
      }
    }
    // The same kind of account through v1 (a "standard" account, described by what it does).
    const a = await s.accounts.create(
      {
        country: 'GB',
        email: input.email,
        business_profile: { name: input.businessName.slice(0, 100) },
        controller: { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe' },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { supplierId: input.supplierId },
      },
      { idempotencyKey: `${input.idempotencyKey}:v1` },
    );
    return { id: a.id };
  }

  async onboardingLink(accountId: string, returnUrl: string, refreshUrl: string) {
    const s = await this.stripe();
    if (!this.v1Only) {
      try {
        const link = await s.v2.core.accountLinks.create({
          account: accountId,
          use_case: { type: 'account_onboarding', account_onboarding: { return_url: returnUrl, refresh_url: refreshUrl } },
        });
        return link.url;
      } catch (err) {
        if (!isV2Blocked(err)) throw err;
        this.v1Only = true;
      }
    }
    const link = await s.accountLinks.create({ account: accountId, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl });
    return link.url;
  }

  async accountStatus(accountId: string) {
    const s = await this.stripe();
    // v1 reads accounts made either way, and gives the three flags we keep.
    return flagsFromAccount(await s.accounts.retrieve(accountId));
  }

  dashboardUrl() {
    return 'https://dashboard.stripe.com/';
  }

  async verifyWebhook(rawBody: string, signature: string | null, endpoint: 'platform' | 'connect') {
    const secret = endpoint === 'connect' ? env().STRIPE_CONNECT_WEBHOOK_SECRET : env().STRIPE_WEBHOOK_SECRET;
    if (!secret || !signature) throw new WebhookSignatureError('No signature');
    const s = await this.stripe();
    let event: Stripe.Event;
    try {
      event = s.webhooks.constructEvent(rawBody, signature, secret, WEBHOOK_TOLERANCE_SECONDS);
    } catch {
      throw new WebhookSignatureError('Bad signature');
    }
    return { id: event.id, type: event.type, created: event.created, account: event.account ?? null, object: event.data.object as unknown as Record<string, unknown> };
  }

  publishableKey() {
    return env().STRIPE_PUBLISHABLE_KEY ?? null;
  }

  async listRefunds(account: string | null, paymentIntentId: string) {
    const s = await this.stripe();
    const out: { id: string; amountPence: number; status: 'succeeded' | 'pending' | 'failed'; created: number }[] = [];
    for await (const r of s.refunds.list({ payment_intent: paymentIntentId, limit: 100 }, account ? { stripeAccount: account } : {})) {
      out.push({ id: r.id, amountPence: r.amount, status: r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' || r.status === 'canceled' ? 'failed' : 'pending', created: r.created });
    }
    return out;
  }

  async createCustomer(input: { email: string; name: string; orderId: string; idempotencyKey: string }) {
    const s = await this.stripe();
    const c = await s.customers.create({ email: input.email, name: input.name.slice(0, 250) || undefined, metadata: { orderId: input.orderId } }, { idempotencyKey: input.idempotencyKey });
    return { id: c.id };
  }

  async createSetupIntent(input: { customerId: string; orderId: string; idempotencyKey: string }) {
    const s = await this.stripe();
    const si = await s.setupIntents.create(
      { customer: input.customerId, usage: 'off_session', allowed_payment_method_types: ['card'], metadata: { orderId: input.orderId } },
      { idempotencyKey: input.idempotencyKey },
    );
    return { id: si.id, clientSecret: si.client_secret };
  }

  async setupIntentStatus(id: string) {
    const s = await this.stripe();
    const si = await s.setupIntents.retrieve(id);
    const status = si.status === 'succeeded' ? 'succeeded' : si.status === 'processing' ? 'processing' : si.status === 'requires_action' ? 'requires_action' : 'failed';
    const pm = typeof si.payment_method === 'string' ? si.payment_method : (si.payment_method?.id ?? null);
    const customer = typeof si.customer === 'string' ? si.customer : (si.customer?.id ?? null);
    return { status: status as 'succeeded' | 'processing' | 'requires_action' | 'failed', paymentMethodId: pm, customerId: customer };
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const s = await this.stripe();
    let paymentMethod = input.paymentMethodId;
    const requestOptions = input.account ? { stripeAccount: input.account } : {};
    try {
      if (input.account) {
        // Copy the card saved on Media10's account to the supplier's, for this charge.
        const cloned = await s.paymentMethods.create({ customer: input.customerId, payment_method: input.paymentMethodId }, { stripeAccount: input.account, idempotencyKey: `${input.idempotencyKey}:pm` });
        paymentMethod = cloned.id;
      }
      const pi = await s.paymentIntents.create(
        {
          amount: input.amountPence,
          currency: 'gbp',
          payment_method: paymentMethod,
          allowed_payment_method_types: ['card'],
          confirm: true,
          off_session: true,
          description: input.description.slice(0, 1000),
          statement_descriptor_suffix: input.statementSuffix.replace(/[^A-Za-z0-9 .-]/g, '').slice(0, 22) || undefined,
          metadata: input.metadata,
          ...(input.account ? { application_fee_amount: input.feePence } : { customer: input.customerId }),
        },
        { ...requestOptions, idempotencyKey: input.idempotencyKey },
      );
      if (pi.status === 'succeeded') return { status: 'succeeded', paymentIntentId: pi.id, chargeId: typeof pi.latest_charge === 'string' ? pi.latest_charge : (pi.latest_charge?.id ?? null) };
      if (pi.status === 'processing') return { status: 'processing', paymentIntentId: pi.id };
      return { status: 'failed', paymentIntentId: pi.id, message: 'Your bank wants you to confirm this payment. Press Pay and follow your bank’s steps.', needsAuthentication: pi.status === 'requires_action' };
    } catch (err) {
      const e = err as { type?: string; code?: string; decline_code?: string; message?: string; raw?: { payment_intent?: { id?: string } } };
      if (e?.type === 'StripeCardError') return { status: 'failed', paymentIntentId: e.raw?.payment_intent?.id ?? null, message: declineMessage(e), needsAuthentication: e.code === 'authentication_required' };
      throw err;
    }
  }

  async refund(input: { account: string | null; paymentIntentId: string; amountPence: number; refundApplicationFee: boolean; idempotencyKey: string; metadata: Record<string, string> }) {
    const s = await this.stripe();
    const r = await s.refunds.create(
      { payment_intent: input.paymentIntentId, amount: input.amountPence, metadata: input.metadata, ...(input.account ? { refund_application_fee: input.refundApplicationFee } : {}) },
      { ...(input.account ? { stripeAccount: input.account } : {}), idempotencyKey: input.idempotencyKey },
    );
    const status = r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' || r.status === 'canceled' ? 'failed' : 'pending';
    return { id: r.id, status: status as 'succeeded' | 'pending' | 'failed', feeRefundedPence: null };
  }
}

/**
 * Stands in for Stripe on a developer's computer: no keys, no money, nothing leaves the machine.
 * Its "set-up page" is /supplier/test-onboarding, which records the account as ready in our database.
 */
export class SimulatedPayments implements PaymentsProvider {
  kind = 'simulator' as const;
  testMode = true;
  calls: { method: string; args: unknown }[] = [];

  async createConnectedAccount(input: { email: string; businessName: string; supplierId: string; idempotencyKey: string }) {
    this.calls.push({ method: 'createConnectedAccount', args: input });
    return { id: `acct_sim${randomUUID().replace(/-/g, '').slice(0, 16)}` };
  }
  async onboardingLink(accountId: string) {
    this.calls.push({ method: 'onboardingLink', args: { accountId } });
    return `/supplier/test-onboarding?account=${encodeURIComponent(accountId)}`;
  }
  async accountStatus() {
    return null;
  }
  dashboardUrl() {
    return null;
  }
  async verifyWebhook(): Promise<StripeEventLite> {
    throw new WebhookSignatureError('The simulator does not receive webhooks.');
  }
  publishableKey() {
    return null;
  }
  async listRefunds() {
    return [];
  }
  async createCustomer(input: { email: string; name: string; orderId: string; idempotencyKey: string }) {
    this.calls.push({ method: 'createCustomer', args: input });
    return { id: `cus_sim${input.orderId.replace(/-/g, '').slice(0, 14)}` };
  }
  async createSetupIntent(input: { customerId: string; orderId: string; idempotencyKey: string }) {
    this.calls.push({ method: 'createSetupIntent', args: input });
    return { id: `seti_sim${randomUUID().replace(/-/g, '').slice(0, 16)}`, clientSecret: null };
  }
  /** The test payment page records the outcome on the order itself, so there's nothing to ask here. */
  async setupIntentStatus() {
    return { status: 'succeeded' as const, paymentMethodId: null, customerId: null };
  }
  async charge(input: ChargeInput): Promise<ChargeResult> {
    this.calls.push({ method: 'charge', args: input });
    // The test payment page can choose a card that one supplier declines: "pm_sim_decline:<supplierId>".
    if (input.paymentMethodId === `pm_sim_decline:${input.metadata.supplierId}`) {
      return { status: 'failed', paymentIntentId: `pi_sim${randomUUID().replace(/-/g, '').slice(0, 16)}`, message: 'Your card was declined (test card). Try another card.', needsAuthentication: false };
    }
    const id = randomUUID().replace(/-/g, '').slice(0, 16);
    return { status: 'succeeded', paymentIntentId: `pi_sim${id}`, chargeId: `ch_sim${id}` };
  }
  async refund(input: { account: string | null; paymentIntentId: string; amountPence: number; refundApplicationFee: boolean; idempotencyKey: string; metadata: Record<string, string> }) {
    this.calls.push({ method: 'refund', args: input });
    return { id: `re_sim${randomUUID().replace(/-/g, '').slice(0, 16)}`, status: 'succeeded' as const, feeRefundedPence: null };
  }
}

let instance: PaymentsProvider | null = null;
let override: PaymentsProvider | null | undefined;

/**
 * Real Stripe once a key is set. Without one, the simulator, but never on a live site, even if it is
 * set up wrongly: there, payments are simply off (null) until Umit adds the Stripe keys.
 */
export function payments(): PaymentsProvider | null {
  if (override !== undefined) return override;
  if (instance) return instance;
  const e = env();
  if (e.STRIPE_SECRET_KEY) instance = new StripeProvider(e.STRIPE_SECRET_KEY);
  else if (!liveSite(e)) instance = new SimulatedPayments();
  return instance;
}

export function simulatorActive(): boolean {
  return payments()?.kind === 'simulator' && !liveSite();
}

/** For tests only: `null` means payments off; `undefined` goes back to the environment. */
export function setPaymentsForTests(p: PaymentsProvider | null | undefined) {
  override = p;
  instance = null;
}
