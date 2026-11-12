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

## Suppliers

**Super admins add suppliers and make their logins by hand; nothing is
emailed** (Umit, 9 November 2026). Adding a supplier makes the company
and an owner login for its main contact, with a one-off password shown
once on screen (four groups of four, no look-alike characters) and a
ready-to-send message to copy. Umit passes it on himself. Only the
password's hash is kept, never the password.

**A one-off password must be changed at the first sign-in.** The account
is marked "must change password": until the supplier chooses their own,
every page sends them to do it, and no action runs. The new password must
differ from the one-off. A lost password gets a new one-off password from
the supplier's page, which also signs them out everywhere. Super admins'
own passwords are never reset from there.

**If the email already has an account**, it's linked to the supplier and
keeps its own password; no one-off password is made.

**A supplier's status is worked out, not stored**: Paused if paused; Ready
to sell once Stripe says it can take payments; Invited until someone from
the supplier has signed in; otherwise Stripe pending. That way it can never
drift from the facts. Pausing needs a reason, which the supplier sees.

**Suppliers belong to the platform, not a show**, because one supplier
serves many shows. Only super admins add them. Show admins assign them to
their shows' categories.

**Connecting Stripe** (12 November 2026). The supplier's owner presses
"Connect with Stripe" on their Payments page; staff can't, but anyone on
the team can press "Check status". We make the connected account with
Stripe's Accounts v2 (falling back to v1 if the platform can't use v2 yet),
with the full Stripe dashboard, the supplier paying Stripe's fees and
Stripe covering losses: the usual set-up for direct charges. An
idempotency key per supplier means one account however often it's pressed.
Status comes from the `account.updated` webhook and "Check status"; each
answer is stamped with when Stripe gave it, so a late, older webhook can't
undo a newer one. Ready to sell needs `charges_enabled`.

**Media10's own services are a supplier of their own kind** ("organiser").
There's at most one. It has no logins and never connects Stripe, because
those lines are charged on Media10's own account; it's Ready to sell unless
paused. Show admins pick it for categories such as stand cleaning, like any
other supplier.

**Categories belong to a show, with one supplier each.** "One supplier per
category per show" holds because a category has a single supplier field,
not a list. A category shows on the storefront only when its supplier is
Ready to sell, and disappears again if they're paused. A supplier with
categories can't be deleted from under them (the database refuses).

**Documents are private.** Insurance and other documents are only served
to someone signed in who may see them: super admins, the supplier's own
people, and the team of a show the supplier serves (read only). The
supplier's owner or a super admin adds and removes them. PDFs, PNGs and
JPEGs up to 5 MB, the real type checked from the contents; PDFs download
rather than open, so nothing in them can run on our site. Insurance must
have an expiry date (the last valid day, UK time).

**Expiry reminders** go 30 days before, once per expiry date, to the
supplier's people and the admins of the shows they supply; every page about
the supplier shows a warning from then on. Uploading a newer document of
the same kind replaces the old one, so its reminder and warning stop. These
are emails, which is different from the supplier logins Umit passes on by
hand: they only go once Resend is set up, and until then each is recorded
as not sent, so nothing is lost.

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

## Money

**Commission's VAT treatment is a setting, not code.** Commission is worked
out on the net (pre-VAT) amount. Whether Media10 charges VAT on it, and
how, is for Umit's accountant to confirm. It is a platform setting, off
until they decide.

**Price approval holds the change, not the product** (12 November 2026).
A new product waits as "pending". A change to a live product's name,
description, picture, prices or VAT is kept beside it while exhibitors go
on seeing (and buying) the approved version; approving swaps it in,
turning it down drops it with a reason the supplier sees. Stock limits,
stand types, codes and taking something off sale apply at once, because
they never put a price up. Media10's own services need no approval.

**The basket is what's still wanted.** Placing an order doesn't empty it;
paying does, part by part. So if one supplier's charge fails, that
supplier's items are still in the basket, and placing a fresh order
cancels the old unpaid part instead of making a duplicate.

**Stock is held for an hour, and the part is cancelled after a day.** An
unpaid order stops holding stock once its hour is up (so nobody is blocked
by an abandoned checkout), but the exhibitor can still press Pay for a
day: we check the stock again and hold it for another hour if it's there.

**Commission is copied onto each line when the order is placed,** worked
out from product → category → supplier → show → platform default. Later
changes never touch placed orders, and a supplier order's application fee
is the sum of its lines.

**One email per payment, not per supplier.** The exhibitor gets one
confirmation listing each supplier's part, with each supplier's invoice
attached, even though their card statement shows a payment per supplier.
