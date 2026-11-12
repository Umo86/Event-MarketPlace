import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/server/env';
import { flagsFromAccount, payments, setPaymentsForTests, simulatorActive } from '@/server/payments/provider';
import { supplierStatus } from '@/lib/supplier-status';

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
  setPaymentsForTests(undefined);
});

function liveSite(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    NODE_ENV: 'production',
    APP_URL: 'https://marketplace.media10.example.com',
    DATABASE_URL: 'postgres://not-used',
    APP_ENCRYPTION_KEY: 'x'.repeat(44),
    CRON_SECRET: 'cron',
    ...extra,
  });
  delete process.env.STRIPE_SECRET_KEY;
  resetEnvCache();
  setPaymentsForTests(undefined);
}

describe('the payment simulator', () => {
  it('runs on a developer’s computer with no Stripe key', () => {
    delete process.env.STRIPE_SECRET_KEY;
    resetEnvCache();
    setPaymentsForTests(undefined);
    expect(payments()?.kind).toBe('simulator');
    expect(simulatorActive()).toBe(true);
  });

  it('never runs on a live site, even when set up wrongly', () => {
    liveSite();
    expect(payments()).toBeNull();
    // Asking for local production on Vercel, or with a real address, changes nothing.
    liveSite({ MARKETPLACE_ALLOW_LOCAL_PRODUCTION: 'true', VERCEL: '1', APP_URL: 'http://localhost:3000' });
    expect(payments()).toBeNull();
    liveSite({ MARKETPLACE_ALLOW_LOCAL_PRODUCTION: 'true' });
    expect(payments()).toBeNull();
    expect(simulatorActive()).toBe(false);
  });

  it('gives way to Stripe once a key is set, in test mode for test keys', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    resetEnvCache();
    setPaymentsForTests(undefined);
    expect(payments()).toMatchObject({ kind: 'stripe', testMode: true });
    expect(simulatorActive()).toBe(false);
  });
});

describe('what Stripe says about an account', () => {
  it('keeps only the three flags, and Ready to sell needs charges_enabled', () => {
    expect(flagsFromAccount({ charges_enabled: true, payouts_enabled: false, details_submitted: true })).toEqual({ chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true });
    expect(supplierStatus({ pausedAt: null, stripeChargesEnabled: false, anyoneSignedIn: true })).toBe('stripe_pending');
    expect(supplierStatus({ pausedAt: null, stripeChargesEnabled: true, anyoneSignedIn: true })).toBe('ready');
    expect(supplierStatus({ kind: 'organiser', pausedAt: null, stripeChargesEnabled: false, anyoneSignedIn: false })).toBe('ready');
    expect(supplierStatus({ kind: 'organiser', pausedAt: new Date(), stripeChargesEnabled: false, anyoneSignedIn: false })).toBe('paused');
  });
});
