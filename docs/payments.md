# Money rules

How money moves in Event MarketPlace (built in phases 1 and 2; test mode only). Share
this with finance and the accountant. **Nothing takes live money until the
pilot, and the pilot waits for the accountant's sign-off.**

## The model

- **The supplier is the seller.** Each supplier connects its own Stripe
  account with "Connect with Stripe". We store only the account id
  (`acct_…`) and whether it can take payments. We never ask for, see or
  store a supplier's Stripe keys.
- **One card entry, one charge per supplier.** The exhibitor enters their
  card once (Stripe's Payment Element, on the show's branded page; we never
  see card numbers). Each supplier's share is then charged straight onto
  that supplier's Stripe account (a direct charge).
- **Media10's commission** is taken as a Stripe application fee on each
  charge. Media10's own services (such as stand cleaning) are charged on
  Media10's own Stripe account, with no fee.
- **Card only.** No pay-on-invoice for anything.
- **Each charge stands alone.** If one supplier's charge fails, the others
  still go through; that supplier's part shows "Payment needed" with a Pay
  button.

## Suppliers connecting Stripe (built in phase 1)

- A supplier's owner presses **Connect with Stripe** on their Payments
  page. The first time, we make their connected account on Media10's
  platform (Stripe's Accounts v2, falling back to v1 if Stripe hasn't
  switched v2 on for the platform yet). It uses the full Stripe dashboard;
  the supplier pays Stripe's fees and Stripe covers losses, which suits
  direct charges. Pressing twice makes one account, not two.
- They then go to Stripe's own set-up pages (an Account Link) and come back
  to their Payments page. If a link expires, Stripe sends them to
  `/supplier/<id>/payments/stripe`, which makes a fresh link for the same
  account.
- We keep the `acct_…` id and three flags: `charges_enabled`,
  `payouts_enabled`, `details_submitted`. They update from the
  `account.updated` webhook and from **Check status**. A late, older event
  never overwrites a newer answer.
- A supplier is **Ready to sell** only when `charges_enabled` is true (and
  they aren't paused). Until then their categories are hidden from
  exhibitors.
- Media10's own services (the "organiser" supplier) never connect: they're
  charged on Media10's own account.

## Paying (built in phase 2)

1. **Basket.** Grouped by supplier, at today's price, for one stand. It
   holds what the exhibitor still wants; paid items leave it.
2. **Place order.** The products are locked, stock is checked and each
   line is priced with its commission. The order (`ORD-000001`, one
   platform-wide sequence) splits into one supplier order per supplier.
   Limited stock is held for an hour. Placing a new order for the same
   stand cancels any earlier unpaid parts (their items are still in the
   basket).
3. **Card.** On Media10's Stripe account we make a Customer and a
   SetupIntent, and the show's branded payment page shows Stripe's Payment
   Element (it handles 3D Secure). The card is saved; we never see it.
4. **Charges.** For each supplier order: the saved card is copied to the
   supplier's account, then a PaymentIntent is created and confirmed there
   (`Stripe-Account` header, `off_session`, `application_fee_amount` = the
   commission), with an idempotency key tied to that supplier order and
   card, and order ids in the metadata. Media10's own lines are a plain
   PaymentIntent on Media10's account with no fee. Each part is locked
   while it's charged, so a refreshed page, a second tab and the
   `setup_intent.succeeded` webhook can never charge twice.
5. **If one fails** (declined, or the bank wants the person there), that
   part shows "Payment needed" with the reason and a Pay button; the
   others are paid and confirmed. Unpaid parts give up their stock after
   the hour, and are cancelled after a day.
6. **Paid.** The part gets the next invoice number in its seller's
   sequence, its VAT invoice PDF is made, and one email to the exhibitor
   lists each part paid, with the invoices attached.

There's no Stripe Checkout (hosted page): it can only pay one account at
a time.

**Stripe API notes (version `2026-10-28.endive`):** card-only is set with
`allowed_payment_method_types: ['card']` on the SetupIntent and each
PaymentIntent; Stripe removed `payment_method_types` from these in
September 2026.

## Amounts

- All money is whole pence (integers). Never decimals.
- Prices are entered before VAT. VAT is rounded once per order line, half
  away from zero, so the basket, Stripe, the invoice and the reports always
  agree.
- The price on an order is the one that applied when it was placed: the
  early-bird price until "early-bird prices end", the late price from "late
  prices start" (both set per show, in UK time).

## Commission

- The first of these that is set is used: product → category → supplier →
  show → platform default.
- Either a percentage (in basis points: 1000 = 10%) or a fixed amount per
  order line.
- Worked out on the net (pre-VAT) amount. A supplier order's application
  fee is the sum of its lines' commission.
- Only show admins and super admins can change it.

**For the accountant to confirm:** whether Media10 charges VAT on its
commission, and how. It's a platform setting, off until they decide.

## Invoices and credit notes

- Each supplier order gets a VAT invoice in the supplier's name (their
  company, address and VAT number), with the show's name and logo at the
  top. Suppliers agree to this in the supplier terms.
- Numbers are gap-free per supplier, e.g. `SPK-INV-000001`, with a prefix
  per supplier. Credit notes follow the same pattern. Media10's own
  services use Media10's own sequence.
- Invoice numbers are given when a supplier order is paid, in the same
  database transaction, so there are never gaps. Credit notes get theirs
  when a refund goes through. Suppliers who aren't VAT registered can only
  sell at 0% VAT, and their documents say "Invoice", not "VAT invoice".
- Exhibitors download their invoices and credit notes from their order
  page only; suppliers and show staff with the Orders right from theirs.
- Each month, a commission statement from Media10 to each supplier: fees
  taken, less fees returned on refunds (phase 4).

## Refunds and disputes

- Suppliers refund their own orders (owner, and staff with the right).
  Show admins, and team members with the Refunds right, can refund on a
  supplier's behalf: each such refund is audited with a reason and the
  supplier is emailed.
- Partial refunds by line or by amount, up to what was paid less earlier
  refunds. Media10's fee comes back in proportion
  (`refund_application_fee: true`).
- Two refunds started at once can never refund the same money.
- Refunds and disputes made in a supplier's own Stripe dashboard sync back:
  a credit note is made, the order updated, the exhibitor emailed. On a
  refund event we ask Stripe for the payment's refunds and record any we
  don't have, by Stripe's refund id, so each is counted once.
- Media10's fee returned on a refund is recorded in proportion straight
  away, then corrected from Stripe's `application_fee.refunded` event.

## Reports

- **Show teams** (Orders right): every supplier order, with the stand, and
  a CSV of every line. With the Reports right, takings by supplier: paid,
  refunded, Media10's commission (less fees returned) and what each
  supplier keeps before Stripe's own fees.
- **Suppliers**: the same for their own orders, with refunds.
- Every figure comes from the supplier orders and refunds, the same rows
  the invoices and credit notes are made from, so they always agree.

## Trying it locally

With no Stripe key on a developer's computer, a payment simulator stands
in for card entry and supplier onboarding. No money moves. Its payment
page has "Pay with a test card" and, for testing, a card that one
supplier declines. Its stand-in
for Stripe's set-up pages is `/supplier/test-onboarding`, which marks the
test account as able to take payments. It can never run on a live web
address: there, with no key, payments are simply off.
