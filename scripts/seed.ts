/**
 * Demo data for a developer's computer and the browser tests: a demo show, its exhibitor list,
 * staff accounts, demo suppliers and categories. Every address ends .test and the show is named as a demo.
 *   npm run seed
 * It refuses to run against a real database (DATABASE_URL set): never put invented exhibitors,
 * suppliers or orders in a live database.
 */
import { eq } from "drizzle-orm";

async function main() {
  if (process.env.DATABASE_URL)
    throw new Error(
      "The seed only runs on the local database. Unset DATABASE_URL.",
    );
  const { getDb, closeDb } = await import("../src/server/db/client");
  const schema = await import("../src/server/db/schema");
  const { hashPassword } = await import("../src/server/security/password");
  const { encryptSecret, sha256Hex } =
    await import("../src/server/security/crypto");
  const { applyList } = await import("../src/server/services/exhibitors");
  const { generateTotpSecret } = await import("../src/server/security/totp");
  const db = await getDb();

  const totp = process.env.SEED_TOTP_SECRET ?? generateTotpSecret();
  const password = process.env.SEED_PASSWORD ?? "local demo password";
  const hash = await hashPassword(password);

  async function user(
    email: string,
    name: string,
    extra: Partial<typeof schema.users.$inferInsert> = {},
  ) {
    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    if (existing) return existing;
    const [u] = await db
      .insert(schema.users)
      .values({
        email,
        name,
        passwordHash: hash,
        totpSecretEnc: encryptSecret(totp),
        totpEnabledAt: new Date(),
        recoveryCodeHashes: [sha256Hex("recov-ery01")],
        ...extra,
      })
      .returning();
    return u;
  }

  const admin = await user("admin@marketplace.test", "Demo Super Admin", {
    isSuperAdmin: true,
  });
  const showAdmin = await user("showadmin@marketplace.test", "Demo Show Admin");
  const team = await user("team@marketplace.test", "Demo Team Member");

  let [show] = await db
    .select()
    .from(schema.shows)
    .where(eq(schema.shows.slug, "demo-expo-2027"))
    .limit(1);
  if (!show) {
    const now = Date.now();
    const day = 86_400_000;
    [show] = await db
      .insert(schema.shows)
      .values({
        name: "Demo Expo London 2027 (demo data)",
        slug: "demo-expo-2027",
        venue: "Demo venue",
        status: "live",
        branding: {
          marketplaceName: "Demo Expo Marketplace",
          primaryColor: "#7a1f3d",
          accentColor: "#ffd166",
          emailSenderName: "Demo Expo Marketplace",
        },
        orderingOpensAt: new Date(now - 7 * day),
        earlyBirdEndsAt: new Date(now + 30 * day),
        latePricesFrom: new Date(now + 60 * day),
        orderingClosesAt: new Date(now + 80 * day),
        helpEmail: "help@marketplace.test",
        helpPhone: "020 7946 0000",
      })
      .returning();
    await db.insert(schema.standTypes).values([
      { showId: show.id, key: "shell_scheme", name: "Shell scheme", sort: 0 },
      { showId: show.id, key: "space_only", name: "Space only", sort: 1 },
    ]);
    await db.insert(schema.showStaff).values([
      {
        showId: show.id,
        userId: showAdmin.id,
        role: "show_admin",
        permissions: [],
      },
      {
        showId: show.id,
        userId: team.id,
        role: "show_team",
        permissions: ["orders"],
      },
    ]);
    await db.transaction((tx) =>
      applyList(
        tx,
        show.id,
        [
          {
            company: "Acme Displays Ltd (demo)",
            stand: "B12",
            hall: "Hall 1",
            standType: "Shell scheme",
            name: "Sam Patel",
            email: "sam@exhibitor.test",
            phone: "020 7946 0001",
          },
          {
            company: "Acme Displays Ltd (demo)",
            stand: "D1",
            hall: "Hall 2",
            standType: "Space only",
            name: "Sam Patel",
            email: "sam@exhibitor.test",
            phone: "",
          },
          {
            company: "Brick & Co (demo)",
            stand: "C4",
            hall: "Hall 2",
            standType: "Space only",
            name: "Jo Brick",
            email: "jo@exhibitor.test",
            phone: "",
          },
        ],
        { replace: false, source: "upload" },
      ),
    );
  }

  // Demo suppliers, all marked (demo). Sparks still has to connect Stripe (the payment simulator
  // stands in locally); Carpets is already "connected"; Media10's own services need nothing.
  async function supplier(
    values: typeof schema.suppliers.$inferInsert,
    login?: { email: string; name: string },
  ) {
    const [existing] = await db
      .select()
      .from(schema.suppliers)
      .where(eq(schema.suppliers.invoicePrefix, values.invoicePrefix))
      .limit(1);
    if (existing) return existing;
    const [row] = await db.insert(schema.suppliers).values(values).returning();
    if (login) {
      const u = await user(login.email, login.name, {
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodeHashes: [],
      });
      await db
        .insert(schema.supplierUsers)
        .values({
          supplierId: row.id,
          userId: u.id,
          role: "owner",
          canRefund: true,
          canEditCatalogue: true,
        });
    }
    return row;
  }
  const sparks = await supplier(
    {
      name: "Bright Sparks Electrical (demo)",
      contactName: "Pat Sparks",
      email: "sparks@supplier.test",
      invoicePrefix: "DSE",
      vatRegistered: true,
      vatNumber: "GB000000000",
      city: "London",
      postcode: "E1 6AN",
    },
    { email: "sparks@supplier.test", name: "Pat Sparks" },
  );
  const carpets = await supplier(
    {
      name: "Carpet Co (demo)",
      contactName: "Lee Weaver",
      email: "carpets@supplier.test",
      invoicePrefix: "DCC",
      vatRegistered: true,
      stripeAccountId: "acct_simdemocarpets",
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
      stripeCheckedAt: new Date(),
    },
    { email: "carpets@supplier.test", name: "Lee Weaver" },
  );
  const [organiser] = await db
    .select()
    .from(schema.suppliers)
    .where(eq(schema.suppliers.kind, "organiser"))
    .limit(1);
  const media10 =
    organiser ??
    (await supplier({
      kind: "organiser",
      name: "Media10 (demo)",
      contactName: "Show team",
      email: "ops@marketplace.test",
      invoicePrefix: "DM10",
      vatRegistered: true,
    }));
  const cats = await db
    .select()
    .from(schema.showCategories)
    .where(eq(schema.showCategories.showId, show.id));
  if (!cats.length) {
    await db.insert(schema.showCategories).values([
      {
        showId: show.id,
        name: "Electrics",
        description: "Sockets, lighting and power",
        supplierId: sparks.id,
        sort: 0,
      },
      {
        showId: show.id,
        name: "Carpet",
        description: "Carpet tiles and roll carpet in show colours",
        supplierId: carpets.id,
        sort: 1,
      },
      {
        showId: show.id,
        name: "Stand cleaning",
        description: "Nightly vacuum and bin empty",
        supplierId: media10.id,
        sort: 2,
      },
      {
        showId: show.id,
        name: "Furniture",
        description: "Chairs, tables and counters",
        supplierId: null,
        sort: 3,
      },
    ]);
  }
  // Demo products, already approved.
  const [anyProduct] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.showId, show.id))
    .limit(1);
  if (!anyProduct) {
    const byName = new Map(
      (
        await db
          .select()
          .from(schema.showCategories)
          .where(eq(schema.showCategories.showId, show.id))
      ).map((c) => [c.name, c]),
    );
    const now = new Date();
    const live = {
      status: "live" as const,
      approvedAt: now,
      reviewedAt: now,
      submittedAt: now,
      showId: show.id,
    };
    const electrics = byName.get("Electrics");
    const carpet = byName.get("Carpet");
    const cleaning = byName.get("Stand cleaning");
    await db.insert(schema.products).values([
      ...(electrics?.supplierId
        ? [
            {
              ...live,
              categoryId: electrics.id,
              supplierId: electrics.supplierId,
              name: "500W socket",
              code: "SKT-500",
              description:
                "One double socket, live from the start of build-up.",
              pricePence: 4500,
              earlyPricePence: 4000,
              latePricePence: 5500,
              sort: 0,
            },
            {
              ...live,
              categoryId: electrics.id,
              supplierId: electrics.supplierId,
              name: "Spotlight on arm",
              code: "LGT-ARM",
              pricePence: 3800,
              stockLimit: 50,
              sort: 1,
            },
          ]
        : []),
      ...(carpet?.supplierId
        ? [
            {
              ...live,
              categoryId: carpet.id,
              supplierId: carpet.supplierId,
              name: "Carpet tiles",
              unit: "m²",
              description: "Laid before build-up, in the show colour.",
              pricePence: 1250,
              sort: 0,
            },
            {
              ...live,
              categoryId: carpet.id,
              supplierId: carpet.supplierId,
              name: "Underlay",
              unit: "m²",
              pricePence: 400,
              standTypeKeys: ["space_only"],
              sort: 1,
            },
          ]
        : []),
      ...(cleaning?.supplierId
        ? [
            {
              ...live,
              categoryId: cleaning.id,
              supplierId: cleaning.supplierId,
              name: "Nightly stand clean",
              description: "Vacuum and bins, each night of the show.",
              pricePence: 3000,
              sort: 0,
            },
          ]
        : []),
    ]);
  }

  await closeDb();
  console.log(`
Demo data ready (local database only).
  Storefront:  http://localhost:3000/demo-expo-2027   exhibitors sam@exhibitor.test, jo@exhibitor.test
  Admin:       http://localhost:3000/sign-in
    ${admin.email} (super admin), ${showAdmin.email} (show admin), ${team.email} (team member)
    Password: ${password}
    Two-factor key for your authenticator app: ${totp}
  Supplier panel: sparks@supplier.test (not connected to Stripe yet), carpets@supplier.test (ready)
    Same password, no two-factor.
  Sign-in codes appear at http://localhost:3000/dev/mailbox
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
