import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PASSWORD, ready, storefrontSignIn } from './helpers';

async function axe(page: import('@playwright/test').Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.html.slice(0, 100)).join(' | ')})`)).toEqual([]);
}

test('an exhibitor orders from two sellers, one card is declined by one, then pays the rest and gets each invoice', async ({ page }) => {
  await storefrontSignIn(page, 'demo-expo-2027', 'jo@exhibitor.test');
  await page.getByRole('link', { name: 'Order services' }).first().click();
  await ready(page);
  const tiles = page.getByTestId('shop-Carpet tiles');
  await tiles.getByLabel('How many Carpet tiles').fill('10');
  await tiles.getByRole('button', { name: 'Add to basket' }).click();
  await expect(page.getByText('Carpet tiles added to your basket.')).toBeVisible();
  await page.getByTestId('shop-Nightly stand clean').getByRole('button', { name: 'Add to basket' }).click();
  await expect(page.getByText('Nightly stand clean added to your basket.')).toBeVisible();
  await axe(page);

  await page.getByRole('link', { name: /^Basket/ }).first().click();
  await ready(page);
  await expect(page.getByTestId('basket-Carpet Co (demo)')).toContainText('£125.00');
  await expect(page.getByTestId('basket-Media10 (demo)')).toContainText('£30.00');
  // £125 + £30 = £155 before VAT, £186 with it.
  await expect(page.getByTestId('basket-total')).toHaveText('Total £186.00');
  await axe(page);
  await page.getByLabel('Your purchase order number (optional)').fill('PO-1234');
  await page.getByRole('button', { name: 'Place order and pay' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}\/pay$/);
  await ready(page);
  await page.getByRole('button', { name: 'Test card that Carpet Co (demo) declines' }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Partly paid')).toBeVisible();
  await expect(page.getByTestId('part-Carpet Co (demo)')).toContainText('Payment needed');
  await expect(page.getByTestId('part-Media10 (demo)')).toContainText('Paid');
  await axe(page);

  await page.getByRole('link', { name: 'Pay £150.00' }).click();
  await ready(page);
  await page.getByRole('button', { name: /Pay £150\.00 with a test card/ }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  const invoice = page.getByTestId('part-Carpet Co (demo)').getByRole('link', { name: /Download invoice DCC-INV-\d{6}/ });
  await expect(async () => {
    await page.reload();
    await expect(invoice).toBeVisible();
  }).toPass({ timeout: 15_000 });
  const href = await invoice.getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  // Someone else's browser can't open it.
  const stranger = await page.context().browser()!.newContext();
  expect((await stranger.request.get(new URL(href!, page.url()).toString())).status()).toBe(404);
  await stranger.close();
  const orderUrl = page.url();

  // The supplier refunds £10 from their own panel.
  const supplierContext = await page.context().browser()!.newContext();
  const supplier = await supplierContext.newPage();
  await supplier.goto('/sign-in');
  await ready(supplier);
  await supplier.getByLabel('Email').fill('carpets@supplier.test');
  await supplier.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await supplier.getByRole('button', { name: 'Sign in' }).click();
  await supplier.waitForURL(/\/supplier\/[0-9a-f-]{36}$/);
  await supplier.getByRole('link', { name: 'Orders', exact: true }).click();
  await ready(supplier);
  await supplier.getByTestId('orders-table').getByRole('row').filter({ hasText: 'Brick & Co (demo)' }).first().getByRole('link').click();
  await ready(supplier);
  await axe(supplier);
  await supplier.getByRole('button', { name: 'Refund…' }).click();
  await supplier.getByText('An amount', { exact: true }).click();
  await supplier.getByLabel(/^Amount/).fill('10');
  await supplier.getByLabel('Reason').fill('One tile short');
  await supplier.getByRole('button', { name: 'Refund £10.00' }).click();
  await expect(supplier.getByText('Refunded. The exhibitor has been emailed a credit note.')).toBeVisible();
  await expect(supplier.getByText(/£10\.00 · done/)).toBeVisible();
  await supplierContext.close();

  // The exhibitor sees it, with a credit note.
  await page.goto(orderUrl);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('link', { name: /credit note DCC-CRN-\d{6}/ })).toBeVisible();
  }).toPass({ timeout: 15_000 });
});
