# Money rules

How money will move in Event MarketPlace (built in phases 1 to 3). Share
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
- Each month, a commission statement from Media10 to each supplier: fees
  taken, less fees returned on refunds.

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
  a credit note is made, the order updated, the exhibitor emailed.

## Trying it locally

With no Stripe key on a developer's computer, a payment simulator stands
in for card entry and supplier onboarding. No money moves. It can never
run on a live web address.
