import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHmac, randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { ready, staffSignIn } from './helpers';

const SLUG = 'demo-expo-2027';

/** A sign-in link token made the way BluePrint makes one (docs/blueprint.md). */
function signInToken(key: string, email: string) {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT', kid: key.slice(3, 15) });
  const body = b64({ iss: 'blueprint', aud: 'event-marketplace', sub: email, iat: now, exp: now + 300, jti: randomBytes(12).toString('base64url') });
  const secret = createHash('sha256').update(`event-marketplace-sign-in:${key}`).digest();
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

async function openShow(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Demo Expo London 2027 (demo data)' }).click();
  await expect(page.getByRole('heading', { name: 'Demo Expo London 2027 (demo data)' })).toBeVisible();
}

test('a show admin changes branding: a hard-to-read colour is refused with a fix, and the storefront updates', async ({ page, browser }) => {
  await staffSignIn(page, 'showadmin@marketplace.test');
  await openShow(page);
  await page.getByRole('link', { name: 'Branding', exact: true }).click();
  await ready(page);
  const main = page.getByLabel('Main colour');
  await main.fill('#ffd400');
  await main.blur();
  await expect(page.getByText(/White text on this colour is too hard to read/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save name and colours' })).toBeDisabled();
  await page.getByRole('button', { name: /^Use #/ }).click();
  await page.getByLabel('Marketplace name').fill('Demo Expo Orders');
  await page.getByRole('button', { name: 'Save name and colours' }).click();
  await expect(page.getByText('Branding saved. The storefront shows it now.')).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);

  // A visitor sees the new name straight away.
  const visitor = await browser.newPage();
  await visitor.goto(`/${SLUG}/sign-in`);
  await expect(visitor.getByRole('link', { name: 'Demo Expo Orders' })).toBeVisible();
  await visitor.close();
});

test('a show admin uploads an exhibitor list, sees the changes first, then applies them', async ({ page }) => {
  await staffSignIn(page, 'showadmin@marketplace.test');
  await openShow(page);
  await page.getByRole('link', { name: 'Exhibitors', exact: true }).click();
  await ready(page);
  const csv = ['Company,Stand,Hall,Stand type,Contact name,Email,Phone', 'New Co (demo),F7,Hall 3,Shell scheme,Nia New,nia@exhibitor.test,'].join('\n');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file' }).click();
  await (await chooser).setFiles({ name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/1 new, 0 changed/)).toBeVisible();
  await expect(page.getByText('New halls: Hall 3.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply these changes' }).click();
  await expect(page.getByText('The exhibitor list is updated.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'nia@exhibitor.test' })).toBeVisible();
});

test('BluePrint can send the list with the show’s key, and sign an exhibitor straight in', async ({ page, request, browser }) => {
  await staffSignIn(page, 'showadmin@marketplace.test');
  await openShow(page);
  await page.getByRole('link', { name: 'Exhibitors', exact: true }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Make a key' }).click();
  const key = (await page.getByText(/^em_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/).textContent())!.trim();
  expect(key).toMatch(/^em_[a-z0-9]{12}_/);

  const url = `/api/public/shows/${SLUG}/exhibitors`;
  // The seeded exhibitors, as BluePrint would send them (anyone left out would be removed).
  const list = {
    exhibitors: [
      { id: 'bp-1', company: 'Acme Displays Ltd (demo)', stand: 'B12', contacts: [{ name: 'Sam Patel', email: 'sam@exhibitor.test' }] },
      { id: 'bp-2', company: 'Acme Displays Ltd (demo)', stand: 'D1', contacts: [{ name: 'Sam Patel', email: 'sam@exhibitor.test' }] },
      { id: 'bp-3', company: 'Brick & Co (demo)', stand: 'C4', contacts: [{ name: 'Jo Brick', email: 'jo@exhibitor.test' }] },
    ],
  };
  expect((await request.post(url, { data: list, headers: { Authorization: 'Bearer em_wrongwrongwr_' + 'x'.repeat(43) } })).status()).toBe(401);
  const ok = await request.post(url, { data: list, headers: { Authorization: `Bearer ${key}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ added: 0, removed: expect.any(Number) });

  const exhibitor = await browser.newPage();
  const token = signInToken(key, 'sam@exhibitor.test');
  await exhibitor.goto(`/${SLUG}/sign-in/link#token=${token}`);
  await exhibitor.waitForURL(new RegExp(`/${SLUG}$`));
  await expect(exhibitor.getByRole('heading', { name: 'Welcome, Sam' })).toBeVisible();
  // The same link never works twice.
  const again = await browser.newPage();
  await again.goto(`/${SLUG}/sign-in/link#token=${token}`);
  await expect(again.getByText(/already been used/)).toBeVisible();
  // An email that isn't on the list gets nowhere, and the page doesn't say why.
  const stranger = await browser.newPage();
  await stranger.goto(`/${SLUG}/sign-in/link#token=${signInToken(key, 'nobody@exhibitor.test')}`);
  await expect(stranger.getByText(/We couldn’t sign you in with this link/)).toBeVisible();
});

test('a team member without admin rights sees no branding, settings or key', async ({ page }) => {
  await staffSignIn(page, 'team@marketplace.test');
  await openShow(page);
  await expect(page.getByRole('link', { name: 'Branding', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Exhibitors', exact: true })).toHaveCount(0);
  const res = await page.goto(page.url().replace(/\/?$/, '/branding'));
  expect(res?.status()).toBe(404);
});

test('a super admin creates a show and the admin pages pass accessibility checks', async ({ page }) => {
  await staffSignIn(page, 'admin@marketplace.test');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.getByRole('link', { name: 'New show' }).click();
  await ready(page);
  await page.getByLabel('Show name').fill('Futurebuild 2027 (demo data)');
  await expect(page.getByLabel('Web address')).toHaveValue('futurebuild-2027-demo-data');
  await page.getByRole('button', { name: 'Create show' }).click();
  await page.waitForURL(/\/branding$/);
  await expect(page.getByRole('heading', { name: 'Futurebuild 2027 (demo data)' })).toBeVisible();
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByText('Created the show Futurebuild 2027 (demo data) at /futurebuild-2027-demo-data')).toBeVisible();
});
