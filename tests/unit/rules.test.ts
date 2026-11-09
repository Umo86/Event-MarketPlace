import { describe, expect, it } from 'vitest';
import { slugify, slugProblem } from '@/lib/slug';
import { ACTIONS, allowedInShow, audienceOf, type ActionName } from '@/server/authz';
import { orderingDateProblems, checkBranding } from '@/server/services/shows';
import { missingProductionSettings, type Env } from '@/server/env';
import { SHOW_PERMISSIONS, type ShowPermission } from '@/server/db/schema';

describe('show web addresses', () => {
  it('are made from the name', () => {
    expect(slugify('UK Construction Week London 2027')).toBe('uk-construction-week-london-2027');
    expect(slugify('Stone & Surface Show')).toBe('stone-and-surface-show');
  });

  it('cannot take an address the app uses', () => {
    expect(slugProblem('admin')).toMatch(/used by the marketplace/);
    expect(slugProblem('api')).toMatch(/used by the marketplace/);
    expect(slugProblem('Bad Slug')).toMatch(/lower case/);
    expect(slugProblem('ukcw-london-2027')).toBeNull();
  });
});

describe('who may do what in a show', () => {
  const all = new Set<ShowPermission>(SHOW_PERMISSIONS);
  const admin = { role: 'show_admin' as const, permissions: all };
  const viewer = { role: 'show_team' as const, permissions: new Set<ShowPermission>() };
  const orders = { role: 'show_team' as const, permissions: new Set<ShowPermission>(['orders']) };
  const showActions = (Object.keys(ACTIONS) as ActionName[]).filter((a) => ACTIONS[a].scope === 'show');
  const rule = (a: ActionName) => ACTIONS[a] as Extract<(typeof ACTIONS)[ActionName], { scope: 'show' }>;

  it('show admins can do everything in their show', () => {
    for (const a of showActions) expect(allowedInShow(rule(a), admin), a).toBe(true);
  });

  it('a team member with no rights can only view', () => {
    const allowed = showActions.filter((a) => allowedInShow(rule(a), viewer));
    expect(allowed).toEqual(['show.view']);
  });

  it('the orders right never brings refunds with it', () => {
    expect(allowedInShow(rule('orders.view'), orders)).toBe(true);
    expect(allowedInShow(rule('orders.refund'), orders)).toBe(false);
  });

  it('branding, the team and the BluePrint key are for show admins only', () => {
    const everything = { role: 'show_team' as const, permissions: all };
    for (const a of ['show.branding.edit', 'show.team.manage', 'show.connection.manage', 'show.settings.edit'] as ActionName[]) {
      expect(allowedInShow(rule(a), everything), a).toBe(false);
    }
  });

  it('storefront actions need a storefront sign-in, everything else an account', () => {
    expect(audienceOf('storefront.order')).toBe('exhibitor');
    expect(audienceOf('show.view')).toBe('user');
  });
});

describe('ordering dates', () => {
  const d = (s: string) => new Date(s);
  it('must run in order', () => {
    expect(orderingDateProblems({ orderingOpensAt: d('2027-01-01'), earlyBirdEndsAt: d('2027-02-01'), latePricesFrom: d('2027-04-01'), orderingClosesAt: d('2027-05-01') })).toEqual({});
    const p = orderingDateProblems({ orderingOpensAt: d('2027-03-01'), earlyBirdEndsAt: d('2027-02-01'), latePricesFrom: null, orderingClosesAt: d('2027-01-01') });
    expect(p.earlyBirdEndsAt).toMatch(/after/);
    expect(p.orderingClosesAt).toMatch(/after/);
  });
});

describe('branding form checks', () => {
  it('blank colours mean "use the default"', () => {
    expect(checkBranding({ marketplaceName: '', primaryColor: '', accentColor: '', emailSenderName: '' })).toEqual({ fieldErrors: {}, primary: null, accent: null });
  });
  it('a hard-to-read colour is refused with a suggestion', () => {
    const r = checkBranding({ marketplaceName: '', primaryColor: '#ffee00', accentColor: '', emailSenderName: '' });
    expect(r.fieldErrors.primaryColor).toMatch(/Try #/);
  });
});

describe('a live site’s settings', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', APP_ENCRYPTION_KEY: 'k', CRON_SECRET: 'c' } as unknown as Env;
  it('refuse a Stripe key without both webhook secrets', () => {
    const missing = missingProductionSettings({ ...base, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_1' } as Env, { APP_URL: 'https://x' });
    expect(missing).toEqual(['STRIPE_CONNECT_WEBHOOK_SECRET']);
  });
  it('are happy with no Stripe at all', () => {
    expect(missingProductionSettings(base, { APP_URL: 'https://x' })).toEqual([]);
  });
});
