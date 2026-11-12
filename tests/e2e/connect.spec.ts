import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PASSWORD, ready, staffSignIn, storefrontSignIn } from './helpers';

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

async function axe(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')})`)).toEqual([]);
}

test('a supplier connects Stripe (simulator), becomes Ready to sell, uploads insurance and appears on the storefront', async ({ page, browser }) => {
  // The exhibitor sees no Electrics yet: its supplier isn't connected.
  const exhibitorContext = await browser.newContext();
  const exhibitor = await exhibitorContext.newPage();
  await storefrontSignIn(exhibitor, 'demo-expo-2027', 'jo@exhibitor.test');
  const services = exhibitor.getByTestId('storefront-categories');
  await expect(services.getByText('Carpet', { exact: true })).toBeVisible();
  await expect(services.getByText('Stand cleaning', { exact: true })).toBeVisible();
  await expect(services.getByText('Electrics', { exact: true })).toHaveCount(0);
  await expect(services.getByText('Furniture', { exact: true })).toHaveCount(0);

  // The supplier signs in (no two-factor for this demo supplier).
  await page.goto('/sign-in');
  await ready(page);
  await page.getByLabel('Email').fill('sparks@supplier.test');
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/supplier\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('supplier-shows').getByText('Demo Expo London 2027 (demo data)')).toBeVisible();

  await page.getByRole('link', { name: 'Payments', exact: true }).click();
  await ready(page);
  await expect(page.getByText('Not connected')).toBeVisible();
  await expect(page.getByText('Test mode: payment simulator')).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Connect with Stripe' }).click();
  await page.waitForURL(/\/supplier\/test-onboarding\?account=acct_sim/);
  await ready(page);
  await page.getByRole('button', { name: 'Finish test set-up' }).click();
  await page.waitForURL(/\/payments\?stripe=return/);
  await expect(page.getByText('Ready to sell', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect with Stripe' })).toHaveCount(0);

  // Insurance with an expiry date three weeks away: added, and warned about.
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await ready(page);
  await page.getByLabel('Expiry date').fill(inDays(21));
  await page.locator('input[type="file"]').setInputFiles({ name: 'public-liability.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('button', { name: 'Add document' }).click();
  await expect(page.getByTestId('documents-table').getByText('Public liability insurance')).toBeVisible();
  await expect(page.getByTestId('document-warning')).toContainText(/Public liability insurance: expires in (20|21|22) days/);
  await expect(page).toHaveTitle(/Documents/);
  await axe(page);

  // The exhibitor now sees Electrics, supplied by them.
  await exhibitor.reload();
  await expect(services.getByText('Electrics', { exact: true })).toBeVisible();
  await expect(services.getByText('Supplied by Bright Sparks Electrical (demo)')).toBeVisible();
  await exhibitorContext.close();
});

test('a show admin assigns a supplier to a category and sees their documents', async ({ page }) => {
  await staffSignIn(page, 'showadmin@marketplace.test');
  await page.getByRole('link', { name: 'Demo Expo London 2027 (demo data)' }).click();
  await page.getByRole('link', { name: 'Categories', exact: true }).click();
  await ready(page);
  await expect(page.getByTestId('category-Electrics').getByLabel('Supplier for Electrics')).toHaveValue(/Bright Sparks Electrical \(demo\)/);
  await axe(page);

  await page.getByPlaceholder('Electrics').fill('Graphics');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByTestId('category-Graphics')).toBeVisible();
  await page.getByTestId('category-Graphics').getByLabel('Supplier for Graphics').click();
  await page.getByRole('option', { name: /Carpet Co \(demo\)/ }).click();
  await expect(page.getByTestId('category-Graphics').getByText('Shown to exhibitors.')).toBeVisible();
  await expect(page.getByText('Suppliers’ documents')).toBeVisible();
});
