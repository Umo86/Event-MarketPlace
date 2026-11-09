/**
 * Creates the first super admin's invitation and prints its link.
 *   BOOTSTRAP_SUPER_ADMIN_EMAIL=you@media10.co.uk npm run bootstrap
 * Accepting it needs an emailed code, then two-factor set-up.
 */
import { eq } from 'drizzle-orm';

async function main() {
  const { randomToken, sha256Hex } = await import('../src/server/security/crypto');
  const { getDb, closeDb } = await import('../src/server/db/client');
  const { invitations, users } = await import('../src/server/db/schema');
  const { env } = await import('../src/server/env');
  const email = (process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? process.argv[2] ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Set BOOTSTRAP_SUPER_ADMIN_EMAIL or pass an email address.');
  const db = await getDb();
  const [existing] = await db.select().from(users).where(eq(users.isSuperAdmin, true)).limit(1);
  if (existing && process.env.FORCE !== 'true') throw new Error(`A super admin already exists (${existing.email}). Invite others from Platform settings.`);
  const token = randomToken(32);
  await db.insert(invitations).values({ tokenHash: sha256Hex(token), email, kind: 'super_admin', expiresAt: new Date(Date.now() + 2 * 24 * 3600 * 1000) });
  console.log(`\nSuper admin invitation for ${email} (works for 48 hours):\n${new URL(`/invite/${token}`, env().APP_URL)}\n`);
  await closeDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
