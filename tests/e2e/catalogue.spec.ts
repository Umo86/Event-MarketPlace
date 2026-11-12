import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PASSWORD, ready, staffSignIn } from './helpers';

async function axe(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.html.slice(0, 100)).join(' | ')})`)).toEqual([]);
}

test('a supplier adds a product, it waits for approval, and a show admin approves it', async ({ page, browser }) => {
  const ctx = await browser.newContext();
  const supplier = await ctx.newPage();
  await supplier.goto('/sign-in');
  await ready(supplier);
  await supplier.getByLabel('Email').fill('carpets@supplier.test');
  await supplier.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await supplier.getByRole('button', { name: 'Sign in' }).click();
  await supplier.waitForURL(/\/supplier\/[0-9a-f-]{36}$/);
  await supplier.getByRole('link', { name: 'Catalogue', exact: true }).click();
  await supplier.getByRole('link', { name: 'Demo Expo London 2027 (demo data)' }).click();
  await ready(supplier);
  await supplier.getByRole('button', { name: 'Add a product' }).click();
  await supplier.getByLabel('Name').fill('Rug, 2 × 3 m');
  await supplier.getByLabel('Price before VAT (£)').fill('85');
  await supplier.getByLabel('Early-bird price (£)').fill('75');
  await supplier.getByRole('button', { name: 'Add and send for approval' }).click();
  await expect(supplier.getByTestId('product-Rug, 2 × 3 m')).toContainText('Waiting for approval');
  await axe(supplier);
  await ctx.close();

  await staffSignIn(page, 'showadmin@marketplace.test');
  await page.getByRole('link', { name: 'Demo Expo London 2027 (demo data)' }).click();
  await page.getByRole('link', { name: 'Products', exact: true }).click();
  await ready(page);
  const waiting = page.getByTestId('waiting-Rug, 2 × 3 m');
  await expect(waiting).toContainText('£85.00 before VAT');
  await axe(page);
  await waiting.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved. Exhibitors see it now.')).toBeVisible();
  await expect(page.getByTestId('waiting-Rug, 2 × 3 m')).toHaveCount(0);
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await ready(page);
  await axe(page);
});
