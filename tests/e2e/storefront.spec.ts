import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ready, storefrontSignIn } from './helpers';

const SLUG = 'demo-expo-2027';

test('an exhibitor on the list signs in with an emailed code and sees their stands', async ({ page }) => {
  await storefrontSignIn(page, SLUG, 'sam@exhibitor.test');
  await expect(page.getByRole('heading', { name: 'Welcome, Sam' })).toBeVisible();
  await expect(page.getByText('Stand B12 · Acme Displays Ltd (demo)')).toBeVisible();
  await expect(page.getByText('Stand D1 · Acme Displays Ltd (demo)')).toBeVisible();
  await expect(page.getByText('Ordering is open, at early-bird prices.')).toBeVisible();
  // The header takes the show's own main colour.
  const header = page.locator('header').first();
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-main').trim());
  expect(brand).toMatch(/^#[0-9a-f]{6}$/);
  expect(brand).not.toBe('#0b5d57');
  const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(brand.slice(i, i + 2), 16)).join(', ')})`;
  await expect(header).toHaveCSS('background-color', rgb);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('You’ve signed out.')).toBeVisible();
  await page.goto(`/${SLUG}`);
  await expect(page).toHaveURL(new RegExp(`/${SLUG}/sign-in$`));
});

test('the sign-in page says the same thing for an email that is not on the list', async ({ page }) => {
  await page.goto(`/${SLUG}/sign-in`);
  await ready(page);
  await page.getByLabel('Email').fill('stranger@nowhere.test');
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByText(/If stranger@nowhere.test is on the exhibitor list for this show, we’ve sent a code/)).toBeVisible();
});

test('a storefront sign-in does not open the admin area', async ({ page }) => {
  await storefrontSignIn(page, SLUG, 'jo@exhibitor.test');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('storefront pages pass automated accessibility checks', async ({ page }) => {
  await page.goto(`/${SLUG}/sign-in`);
  await ready(page);
  const signIn = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(signIn.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await storefrontSignIn(page, SLUG, 'sam@exhibitor.test');
  const home = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(home.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test('an unknown show is not found', async ({ page }) => {
  const res = await page.goto('/no-such-show-2099');
  expect(res?.status()).toBe(404);
});
