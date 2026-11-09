# Decisions

Why Event MarketPlace is built the way it is. Newest decisions go at the
bottom of their section. Don't reopen the first five: Umit has made them.

## Made by Umit (do not reopen)

1. **The supplier is the seller.** Each supplier connects its own Stripe
   account, and each supplier's share of an order is charged straight onto
   that account (Stripe Connect direct charges).
2. **Commission comes back in proportion on a refund.** Refunds are made
   with `refund_application_fee: true`, so Media10's fee is returned in the
   same proportion as the amount refunded.
3. **Card only.** There is no pay-on-invoice option for any service,
   including Media10's own.
4. **Show admins can refund on a supplier's behalf.** Each such refund is
   written to the audit log with a reason, and the supplier is emailed.
5. **Never ask suppliers for Stripe API keys.** Since 30 September 2024
   Stripe requires platforms to use Connect or OAuth instead. Suppliers
   press "Connect with Stripe"; we store only their `acct_…` id.

## Shape of the data

**One table for shows.** BluePrint has shows (UK Construction Week) and
editions (London 2027). Here a show is the dated event exhibitors order
for, such as "UK Construction Week London 2027" at `/ukcw-london-2027`.
Everything hangs off it: branding, exhibitors, stands, categories,
suppliers assigned, orders. A show for next year is a new show. This keeps
every screen and every permission one level simpler. If a "series" is
wanted later (to copy a show's set-up forward), it can be added on top.

**Exhibitors are a list, not accounts.** Each show has its own exhibitor
list: one row per contact per stand (company, stand, hall, stand type,
contact name, email, phone). An exhibitor signs in to one show's
storefront by email code or by a signed sign-in from BluePrint or Billie,
and only if their email is on that show's list. They get no password and
no account page. Taking an email off the list ends their access at once.

**Exhibitor sign-ins are kept apart from staff and supplier sign-ins.** An
exhibitor session belongs to one show and can only do exhibitor things in
that show. Its cookie is limited to the show's own web address
(`/<show-slug>`), so someone can be signed in to two shows' storefronts at
once, and a storefront sign-in can never open the admin or supplier panels,
even if the same email belongs to a supplier or a Media10 person. This
matters because the signed sign-in from BluePrint trusts BluePrint's key:
that key must never be able to unlock anything but a storefront.

**The same exhibitor keeps their record across re-uploads,** matched by
email plus stand number. Rows missing from a new upload are marked removed
(never deleted), so past orders keep their stand and contact.

## Signing in

**Staff and suppliers**: email and password, or an emailed code, then
two-factor. Media10 staff (super admins and show teams) must use two-factor;
suppliers may turn it on. This is BluePrint's sign-in, carried across.

**Exhibitors, by emailed code**: six digits, works once, lasts 10 minutes,
5 tries. Rate limited per email and per network. The page says the same
thing whether or not the email is on the list.

**Exhibitors, signed in from BluePrint or Billie**: each show has one key
(`em_` + a 12-character id + `_` + 43 random characters). It's shown once,
and we keep only its SHA-256 (to check list uploads) and, encrypted, a
signing key made from it (to check sign-ins). The sign-in is a JWT: HS256
only, the key id in the header, issuer `blueprint` or `billie`, audience
`event-marketplace`, the exhibitor's email as the subject, and at most 15
minutes between when it was made and when it ends (a minute's clock
difference allowed). Each one works once (its `jti` is recorded). It goes
after the `#` of the address (`/<show-slug>/sign-in/link#token=…`), so it
never reaches a server log; the page takes it out of the address at once.
This follows Billie's BluePrint sign-in, with a shorter life and single
use, because here it opens a shop rather than a chat.

**The same key sends the exhibitor list** (`POST
/api/public/shows/<slug>/exhibitors`, the key as a bearer token). The whole
list each time, checked with zod, at most 5,000 rows and 4 MB, rate limited
per network before the key is checked and per show after.

## Branding

**Built from stored values only.** A show admin picks a main colour, an
accent colour and uploads images. The server checks each colour is a hex
value and passes the contrast test, then turns them into CSS variables on
the storefront. No admin can type CSS or HTML.

**Contrast rules (WCAG AA, 4.5:1).** The main colour is used for buttons
with white text and for links on white, so it must reach 4.5:1 against
white. The accent colour is used behind dark text (highlights, badges), so
it must reach 4.5:1 against dark text (#1a1b1e). A colour that fails is
refused, with the nearest darker (main) or lighter (accent) version that
passes offered instead.

**Images.** Logo (PNG, JPEG or SVG, up to 1 MB), light logo for dark
backgrounds (same), banner (PNG or JPEG, up to 5 MB), favicon (PNG, up to
256 KB). The real file type is checked from its contents. SVGs are cleaned
to a fixed list of drawing tags and attributes (no scripts, no event
handlers, no links out, no embedded styles), and served with a strict
Content-Security-Policy as well. Every upload is a new file with a new
address, so a changed logo shows at once everywhere (no stale caches).

**Fallback.** A show without its own branding uses the platform defaults a
super admin sets, named "Event MarketPlace". The admin and supplier panels
always use the plain Event MarketPlace look, with the current show's name
and logo at the top.

## Running it

**Permissions in one place.** Every action has a name (`show.branding.edit`,
`exhibitors.manage`, …) and one module decides who may do it, for which
show or supplier. Server actions go through `runAction()`; pages call
`requireActor()`. Copied from Billie's pattern; BluePrint's permission
helpers sit underneath.

**Audit log in the same transaction, append-only.** If the change is saved,
so is the record of who made it. A database trigger refuses any update or
delete on the audit log.

**A job queue in Postgres** (from Billie): no extra service to pay for.
Jobs are claimed with `FOR UPDATE SKIP LOCKED` under a lease, retried with
back-off, and kept for a person to see when they fail. Work starts straight
after the request that queued it, and Vercel Cron sweeps the queue every
ten minutes for anything left.

**Email from one verified domain.** Every show's emails come from the same
Resend domain; only the sender name changes ("UKCW London Marketplace").

**On a developer's computer nothing needs an account or key.** The database
is embedded Postgres (PGlite) in `.data/`, files go to `.data/files`, email
goes to a local mailbox at `/dev/mailbox`, and a payment simulator stands
in for Stripe. None of these stand-ins can run on a live web address.

## Money (for phase 2, recorded now)

**Commission's VAT treatment is a setting, not code.** Commission is worked
out on the net (pre-VAT) amount. Whether Media10 charges VAT on it, and
how, is for Umit's accountant to confirm. It is a platform setting, off
until they decide.
