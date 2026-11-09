# Working on Event MarketPlace

Read `README.md` for what Event MarketPlace is and `DECISIONS.md` for why it
is built this way. These are the rules that keep it reliable. The owner,
Umit, is not a developer: write everything he reads in plain British
English.

## Commands

- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck`
- `npm test`: Vitest. Each test file gets a fresh, empty database
  (embedded Postgres in memory), so tests never share data.
- `npm run build && npm run test:e2e`: Playwright against the production
  build, on a freshly seeded local database.
- `npm run db:generate -- --name <what_changed>` after editing
  `src/server/db/schema/*`. Migrations run on every Vercel deploy
  (`npm run db:migrate`) and by themselves on a developer's computer.

## Rules

- **Permissions:** every server action goes through `runAction()`
  (`src/server/actions.ts`) with a named action from the one authz module
  (`src/server/authz/index.ts`). Pages call `requireActor(action, target)`.
  Never check roles anywhere else.
- **Public routes** (the storefront sign-in, `src/app/api/public`, webhooks,
  the BluePrint import): validate input with zod and rate limit writes.
  Never trust a show, role or price the caller sends: the show comes from
  the address and the database, and prices always come from the database.
- **Database:** Drizzle queries or `sql` tags with bound values only. No SQL
  built from strings. Migrations are additive, made with `drizzle-kit
  generate`; never edit one that has been applied anywhere.
- **Audit:** anything a person changes writes `writeAudit()` in the same
  transaction as the change. The audit log is append-only: a database
  trigger refuses updates and deletes.
- **Slow work** (emails, PDFs, imports, Stripe retries) goes on the Postgres
  job queue (`enqueue()` in `src/server/jobs/queue.ts`, then `kickJobs()`),
  never inline in a request that could time out. Vercel Cron sweeps the
  queue.
- **Money:** whole pence (integers) only. Prices entered before VAT. VAT
  rounded once per line, half away from zero. See `docs/payments.md`.
- **Stripe:** never ask suppliers for API keys. Suppliers connect with
  Stripe Connect; store only their `acct_…` id and status flags. Check
  Stripe's current docs before changing payment code.
- **Branding:** built on the server from stored, validated values only
  (hex colours, file ids). Never accept free-form CSS or HTML from admins.
- **Secrets** never go in code, tests or logs. `.env*` is git-ignored
  except `.env.example`. Umit puts keys into Vercel himself.
- **Code layout:** server-only modules start with `import 'server-only'`.
  Files with `'use client'` export components only; shared constants and
  pure helpers live in `src/lib/`.
- **Mantine in server components:** use the named parts (`ListItem`,
  `TableTr`), never `List.Item` or `Table.Tr`, and `LinkButton` /
  `LinkAnchor` (`src/components/ui/links.tsx`) instead of
  `component={Link}`. Both break across the server–browser boundary.
- **Copy:** plain British English, sentence case, short sentences, no
  jargon. Errors say what happened and what to do next.
- **Data:** never create invented suppliers, exhibitors or orders in a live
  database. Demo data is for local and test databases only, marked as demo.

## Before each commit

```
npm run lint && npm run typecheck && npm test
```

For anything visible, also:

```
npm run build && npm run test:e2e
```

Every behaviour change gets a test.

## Next.js

This project uses Next.js 16, which has breaking changes from older
versions. Read the guides in `node_modules/next/dist/docs/` before writing
routing or data-fetching code. Middleware is called a proxy
(`src/proxy.ts`).
