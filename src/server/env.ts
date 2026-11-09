import 'server-only';
import { z } from 'zod';
import { R2_JURISDICTIONS } from '@/lib/storage-origin';
import { isLocalAddress } from '@/lib/local-address';

/**
 * Settings, checked once on first use. A live site refuses to start without the secrets it needs;
 * a developer's computer falls back to safe local stand-ins. Umit puts every key into Vercel
 * himself: none are ever written in code.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Database: Neon in production; embedded PGlite on a developer's computer.
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('.data/pglite'),

  // 32 random bytes, base64. Encrypts two-factor secrets and each show's signing key.
  APP_ENCRYPTION_KEY: z.string().optional(),
  APP_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),

  // Email through Resend, from one verified domain. Each show only changes the sender name.
  EMAIL_PROVIDER: z.enum(['resend', 'outbox']).default('outbox'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().email().default('no-reply@localhost.test'),

  // Files: Cloudflare R2 in production, a local folder on a developer's computer.
  STORAGE_PROVIDER: z.enum(['r2', 'local']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/files'),
  R2_ACCOUNT_ID: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/i, 'R2_ACCOUNT_ID should be the 32-character Cloudflare account ID')
    .optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_JURISDICTION: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : undefined), z.enum(R2_JURISDICTIONS).optional()),

  // Stripe (test keys until the pilot). Two webhook endpoints, each with its own secret.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),

  // Vercel Cron sends this as a bearer token.
  CRON_SECRET: z.string().optional(),

  // First super admin, made by `npm run bootstrap`.
  BOOTSTRAP_SUPER_ADMIN_EMAIL: z.string().email().optional(),

  // "off" switches two-factor off for everyone (only while testing). Turn it back on before launch.
  TWO_FACTOR: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? (['off', 'false', '0', 'no'].includes(v.trim().toLowerCase()) ? 'off' : 'on') : undefined),
    z.enum(['on', 'off']).default('on'),
  ),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** What a live site needs before it will start. Pure, so it can be tested. */
export function missingProductionSettings(value: Env, raw: Record<string, string | undefined>): string[] {
  const missing: string[] = [];
  if (!raw.APP_URL) missing.push('APP_URL');
  if (!value.DATABASE_URL) missing.push('DATABASE_URL');
  if (!value.APP_ENCRYPTION_KEY) missing.push('APP_ENCRYPTION_KEY');
  if (!value.CRON_SECRET) missing.push('CRON_SECRET');
  // Payments are optional until phase 2, but a Stripe key without both webhook secrets would take
  // money without being able to confirm it, so that never starts.
  if (value.STRIPE_SECRET_KEY) {
    if (!value.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET');
    if (!value.STRIPE_CONNECT_WEBHOOK_SECRET) missing.push('STRIPE_CONNECT_WEBHOOK_SECRET');
    if (/^pk_/.test(value.STRIPE_SECRET_KEY)) missing.push('STRIPE_SECRET_KEY (a publishable key was given; use the secret or restricted key)');
  }
  return missing;
}

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid settings: ${parsed.error.message}`);
  const value = parsed.data;
  if (value.NODE_ENV === 'production') {
    const missing = missingProductionSettings(value, process.env);
    if (missing.length && !localProductionAllowed()) {
      throw new Error(`Missing required production settings: ${missing.join(', ')}`);
    }
  }
  cached = value;
  return value;
}

/**
 * Trying a production build on a developer's computer (MARKETPLACE_ALLOW_LOCAL_PRODUCTION=true)
 * relaxes a few rules. It only applies when the address is this computer and it is not running on
 * Vercel, so a live site can never use it.
 */
export function localProductionAllowed() {
  return process.env.MARKETPLACE_ALLOW_LOCAL_PRODUCTION === 'true' && !process.env.VERCEL && isLocalAddress(process.env.APP_URL);
}

export function isProduction() {
  return env().NODE_ENV === 'production';
}

/** A live site, as opposed to development, tests or a production build tried on this computer. */
export function liveSite(e: Env = env()) {
  return e.NODE_ENV === 'production' && !localProductionAllowed();
}

/**
 * How email goes out: through Resend once its key is set; kept in the local mailbox for development
 * and tests; or "off" on a live site with no Resend key yet, where each email is recorded as not sent.
 */
export function emailMode(): 'resend' | 'outbox' | 'off' {
  const e = env();
  if (e.EMAIL_PROVIDER === 'resend' && e.RESEND_API_KEY) return 'resend';
  if (liveSite(e) || e.EMAIL_PROVIDER === 'resend') return 'off';
  return 'outbox';
}

/**
 * Where files are kept: R2 once all its settings are in; a local folder for development; or "off"
 * on a live site without R2, where uploads are refused (a server's own disk is wiped).
 */
export function storageMode(): 'r2' | 'local' | 'off' {
  const e = env();
  if (e.STORAGE_PROVIDER === 'r2' && e.R2_ACCOUNT_ID && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY && e.R2_BUCKET) return 'r2';
  if (liveSite(e) || e.STORAGE_PROVIDER === 'r2') return 'off';
  return 'local';
}

export function twoFactorOn() {
  return env().TWO_FACTOR === 'on';
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}
