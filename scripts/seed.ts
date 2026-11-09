/**
 * Demo data for a developer's computer and the browser tests: a demo show, its exhibitor list and
 * staff accounts. Every address ends .test and the show is named as a demo.
 *   npm run seed
 * It refuses to run against a real database (DATABASE_URL set): never put invented exhibitors,
 * suppliers or orders in a live database.
 */
import { eq } from 'drizzle-orm';

async function main() {
  if (process.env.DATABASE_URL) throw new Error('The seed only runs on the local database. Unset DATABASE_URL.');
  const { getDb, closeDb } = await import('../src/server/db/client');
  const schema = await import('../src/server/db/schema');
  const { hashPassword } = await import('../src/server/security/password');
  const { encryptSecret, sha256Hex } = await import('../src/server/security/crypto');
  const { applyList } = await import('../src/server/services/exhibitors');
  const { generateTotpSecret } = await import('../src/server/security/totp');
  const db = await getDb();

  const totp = process.env.SEED_TOTP_SECRET ?? generateTotpSecret();
  const password = process.env.SEED_PASSWORD ?? 'local demo password';
  const hash = await hashPassword(password);

  async function user(email: string, name: string, extra: Partial<typeof schema.users.$inferInsert> = {}) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing) return existing;
    const [u] = await db
      .insert(schema.users)
      .values({ email, name, passwordHash: hash, totpSecretEnc: encryptSecret(totp), totpEnabledAt: new Date(), recoveryCodeHashes: [sha256Hex('recov-ery01')], ...extra })
      .returning();
    return u;
  }

  const admin = await user('admin@marketplace.test', 'Demo Super Admin', { isSuperAdmin: true });
  const showAdmin = await user('showadmin@marketplace.test', 'Demo Show Admin');
  const team = await user('team@marketplace.test', 'Demo Team Member');

  let [show] = await db.select().from(schema.shows).where(eq(schema.shows.slug, 'demo-expo-2027')).limit(1);
  if (!show) {
    const now = Date.now();
    const day = 86_400_000;
    [show] = await db
      .insert(schema.shows)
      .values({
        name: 'Demo Expo London 2027 (demo data)',
        slug: 'demo-expo-2027',
        venue: 'Demo venue',
        status: 'live',
        branding: { marketplaceName: 'Demo Expo Marketplace', primaryColor: '#7a1f3d', accentColor: '#ffd166', emailSenderName: 'Demo Expo Marketplace' },
        orderingOpensAt: new Date(now - 7 * day),
        earlyBirdEndsAt: new Date(now + 30 * day),
        latePricesFrom: new Date(now + 60 * day),
        orderingClosesAt: new Date(now + 80 * day),
        helpEmail: 'help@marketplace.test',
        helpPhone: '020 7946 0000',
      })
      .returning();
    await db.insert(schema.standTypes).values([
      { showId: show.id, key: 'shell_scheme', name: 'Shell scheme', sort: 0 },
      { showId: show.id, key: 'space_only', name: 'Space only', sort: 1 },
    ]);
    await db.insert(schema.showStaff).values([
      { showId: show.id, userId: showAdmin.id, role: 'show_admin', permissions: [] },
      { showId: show.id, userId: team.id, role: 'show_team', permissions: ['orders'] },
    ]);
    await db.transaction((tx) =>
      applyList(
        tx,
        show.id,
        [
          { company: 'Acme Displays Ltd (demo)', stand: 'B12', hall: 'Hall 1', standType: 'Shell scheme', name: 'Sam Patel', email: 'sam@exhibitor.test', phone: '020 7946 0001' },
          { company: 'Acme Displays Ltd (demo)', stand: 'D1', hall: 'Hall 2', standType: 'Space only', name: 'Sam Patel', email: 'sam@exhibitor.test', phone: '' },
          { company: 'Brick & Co (demo)', stand: 'C4', hall: 'Hall 2', standType: 'Space only', name: 'Jo Brick', email: 'jo@exhibitor.test', phone: '' },
        ],
        { replace: false, source: 'upload' },
      ),
    );
  }
  await closeDb();
  console.log(`
Demo data ready (local database only).
  Storefront:  http://localhost:3000/demo-expo-2027   exhibitors sam@exhibitor.test, jo@exhibitor.test
  Admin:       http://localhost:3000/sign-in
    ${admin.email} (super admin), ${showAdmin.email} (show admin), ${team.email} (team member)
    Password: ${password}
    Two-factor key for your authenticator app: ${totp}
  Sign-in codes appear at http://localhost:3000/dev/mailbox
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
