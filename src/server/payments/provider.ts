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
