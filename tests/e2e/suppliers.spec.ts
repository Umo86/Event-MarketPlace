import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ready, staffSignIn } from './helpers';

test('a super admin adds a supplier, passes on the login, and the supplier signs in and chooses a password', async ({ page, browser }) => {
  await staffSignIn(page, 'admin@marketplace.test');
  await page.getByRole('link', { name: 'Suppliers' }).click();
  await page.getByRole('link', { name: 'Add supplier' }).click();
  await ready(page);
  await page.getByLabel('Company name').fill('Sparks Electrical (demo)');
  await page.getByLabel('Main contact’s name').fill('Pat Sparks');
  await page.getByLabel('Main contact’s email').fill('pat@sparks.test');
  await expect(page.getByLabel('Invoice prefix')).toHaveValue('SED');
  await page.getByRole('button', { name: 'Add supplier and make their login' }).click();
  await expect(page.getByText('Login details to pass on')).toBeVisible();
  const password = (await page.getByTestId('one-off-password').textContent())!.trim();
  expect(password).toMatch(/^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.getByRole('link', { name: 'Go to Sparks Electrical (demo)' }).click();
  await expect(page.getByText('Invited', { exact: true })).toBeVisible();

  // The supplier, on their own computer.
  const context = await browser.newContext();
  const supplier = await context.newPage();
  await supplier.goto('/sign-in');
  await ready(supplier);
  await supplier.getByLabel('Email').fill('pat@sparks.test');
  await supplier.locator('input[autocomplete="current-password"]').fill(password);
  await supplier.getByRole('button', { name: 'Sign in' }).click();
  await supplier.waitForURL(/\/choose-password/);
  await ready(supplier);
  const fields = supplier.locator('input[autocomplete="new-password"]');
  await fields.nth(0).fill('a password only pat knows');
  await fields.nth(1).fill('a password only pat knows');
  await supplier.getByRole('button', { name: 'Save and continue' }).click();
  await supplier.waitForURL(/\/supplier\/[0-9a-f-]{36}$/);
  await expect(supplier.getByRole('heading', { name: 'Sparks Electrical (demo)' })).toBeVisible();
  await expect(supplier.getByText('Stripe pending')).toBeVisible();
  const panelAxe = await new AxeBuilder({ page: supplier }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(panelAxe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

  // Suppliers never reach Media10's admin area.
  await supplier.goto('/admin');
  await supplier.waitForURL(/\/supplier\//);
  await context.close();
});
