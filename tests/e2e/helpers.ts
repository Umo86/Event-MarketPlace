import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'local demo password';
const TOTP_SECRET = process.env.E2E_TOTP_SECRET ?? 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function base32(input: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '')) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The authenticator code the seeded staff accounts expect right now. */
export function totp(offsetSteps = 0) {
  const counter = Math.floor(Date.now() / 30_000) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32(TOTP_SECRET)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}

export async function ready(page: Page) {
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
}

/** Signs a seeded staff account in with password and two-factor. */
/** Signs a seeded staff account in with password and two-factor. */
export async function staffSignIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await ready(page);
  await page.getByLabel('Email').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/two-factor/);
  await ready(page);
  // Each authenticator code works once per account. If an earlier test just used this one,
  // wait for the next and try again.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel('Code from your authenticator app').fill(totp());
    await page.getByRole('button', { name: 'Continue' }).click();
    const outcome = await Promise.race([
      page.waitForURL(/\/admin/).then(() => 'in' as const),
      page.getByText('That code didn’t work.').first().waitFor().then(() => 'again' as const),
    ]);
    if (outcome === 'in') return;
    await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
    await page.reload();
    await ready(page);
  }
  throw new Error('Two-factor sign-in failed twice');
}

/** The newest sign-in code sent to an address, read from the local mailbox. */
export async function latestCode(page: Page, email: string) {
  const mailbox = await page.context().newPage();
  let code = '';
  await expect(async () => {
    await mailbox.goto('/dev/mailbox');
    const subject = mailbox.getByRole('row').filter({ hasText: email }).first().getByTestId('mail-subject');
    const text = (await subject.textContent()) ?? '';
    code = /\b(\d{6})\b/.exec(text)?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/);
  }).toPass({ timeout: 15_000 });
  await mailbox.close();
  return code;
}

export async function storefrontSignIn(page: Page, slug: string, email: string) {
  await page.goto(`/${slug}/sign-in`);
  await ready(page);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  await expect(page.getByText(/we’ve sent a code/)).toBeVisible();
  const code = await latestCode(page, email);
  await page.getByLabel('Six-digit code').first().click();
  await page.keyboard.type(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(new RegExp(`/${slug}$`));
}
