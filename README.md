# Event MarketPlace

Event MarketPlace is where exhibitors at trade shows order services for
their stand from approved suppliers: furniture, carpet, electrics,
nameboards, cleaning, graphics, AV and anything else the organiser sets up.
It is built for Media10 (UK Construction Week, Futurebuild, Stone & Surface
Show) and runs many shows at once.

- **The supplier is the seller.** Each supplier connects its own Stripe
  account and is paid directly. Media10 earns commission on each charge.
- **Suppliers run their own orders and money** in their own panel:
  payments, refunds, disputes and orders by stand.
- **Every show has its own branded storefront**: name, logo, colours,
  banner and web address (`/ukcw-london-2027`).

## Who uses it

| Who | What they do |
| --- | --- |
| Super admin | Media10 platform owners: shows, suppliers, platform defaults, commission, all money views |
| Show admin | Media10 ops for a show: branding, exhibitors, categories, suppliers, price approval, refunds, reports |
| Show team member | Media10 staff with the rights a show admin gives them |
| Supplier owner and staff | Their own catalogue, orders, payments, refunds, disputes and team |
| Exhibitor | Order for their stand on their show's storefront, pay, see orders and invoices |

## Where the build is

| Phase | What | Status |
| --- | --- | --- |
| 0 | Foundation: sign-in, audit log, job queue, shows and branding, exhibitor lists, exhibitor sign-in | Done |
| 1 | Supplier accounts and Stripe Connect | In progress: adding suppliers and their logins is done; Stripe Connect, show and category assignment, and documents are next |
| 2 | Catalogue, checkout and charges | Not started |
| 3 | Supplier panel | Not started |
| 4 | Admin oversight | Not started |
| 5 | Pilot with real suppliers and live payments | Not started |

Nothing takes live money until the pilot, and the pilot waits for Umit's
accountant to sign off the VAT points.

## Running it on your computer

You need Node.js 22 or later.

```bash
npm install
npm run seed     # a demo show, exhibitors and staff (local database only)
npm run dev
```

Open http://localhost:3000. Nothing needs an account or key: the database
is embedded in `.data/`, files go to `.data/files`, and emails (including
sign-in codes) appear in the local mailbox at
http://localhost:3000/dev/mailbox. The seed prints the accounts to sign in
with.

## Checks

```bash
npm run lint
npm run typecheck
npm test                              # logic and database tests
npm run build && npm run test:e2e     # browser tests against the production build
```

Browser tests need Chromium. If Playwright can't find its own copy, point it
at one: `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Where things are

| Folder | What |
| --- | --- |
| `src/app/[show]` | A show's branded storefront for exhibitors |
| `src/app/admin` | Super admins and show teams |
| `src/app/supplier` | The supplier panel (from phase 1) |
| `src/app/api` | The BluePrint import, webhooks, scheduled jobs |
| `src/server/services` | Business rules; each checks who is asking |
| `src/server/authz` | The one place that decides who may do what |
| `src/server/auth`, `src/server/security` | Sign-in and security helpers |
| `src/server/jobs` | The job queue |
| `drizzle` | Database migrations |
| `tests` | Unit, database and browser tests |
| `docs` | Guides: [deployment](docs/deployment.md), [the BluePrint connection](docs/blueprint.md), [money rules](docs/payments.md) |

Rules for working on the code are in `CLAUDE.md`; why it's built this way
is in `DECISIONS.md`.

Built with Next.js 16, React 19, Mantine 9, Drizzle ORM on Neon Postgres,
Stripe, Resend and Cloudflare R2. Hosted on Vercel. Much of the code comes
from BluePrint, Umit's exhibitor-manual app.
