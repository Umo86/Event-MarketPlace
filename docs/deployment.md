# Putting it live

What Umit does himself, in order. Claude never types, prints or stores a
key or password: you put them into Vercel yourself.

## 1. GitHub

The repository is `Umo86/event-marketplace`. Every push to `main` deploys.

## 2. Database (Neon)

1. In Neon, create a project called **event-marketplace** in the London
   region (AWS eu-west-2).
2. Copy two connection strings from **Connect**:
   - the **pooled** one (the host contains `-pooler`): this is
     `DATABASE_URL`;
   - the **direct** one: this is `DATABASE_URL_UNPOOLED` (used only to
     set up the tables during each deploy).

Or ask Claude to create the Neon project through the Neon connection, and
then copy the strings yourself.

## 3. Hosting (Vercel)

1. In Vercel, **Add New → Project**, import `Umo86/event-marketplace`.
2. Under **Settings → Environment Variables**, add these for Production
   (the list with explanations is in `.env.example`):

   | Name | What |
   | --- | --- |
   | `APP_URL` | The site's address, e.g. `https://marketplace.media10.co.uk` |
   | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | From Neon, step 2 |
   | `APP_ENCRYPTION_KEY` | 32 random bytes: run `openssl rand -base64 32`. Keep a copy in your password manager |
   | `CRON_SECRET` | Run `openssl rand -hex 32` |
   | `RESEND_API_KEY`, `EMAIL_PROVIDER=resend`, `EMAIL_FROM_ADDRESS` | Step 4 |
   | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_JURISDICTION`, `STORAGE_PROVIDER=r2` | Step 5 |

3. Deploy. The build sets up the database tables by itself.

Until email and file storage are added, the site still runs: emails are
recorded but not sent, and uploads are switched off with a clear message.

## 4. Email (Resend)

1. In Resend, add and verify a sending domain such as
   `mail.media10.co.uk`. Add the DNS records it gives you (SPF and DKIM),
   and a DMARC record.
2. Create an API key with sending access: that's `RESEND_API_KEY`.
3. `EMAIL_FROM_ADDRESS` is an address on that domain, e.g.
   `marketplace@mail.media10.co.uk`. Each show only changes the name it
   comes from.

## 5. Files (Cloudflare R2)

1. In Cloudflare, create an R2 bucket called `event-marketplace-files`
   (EU jurisdiction is fine: then set `R2_JURISDICTION=eu`).
2. Create an R2 API token with read and write access to that bucket only.
   Its access key id and secret go into Vercel.
3. `R2_ACCOUNT_ID` is the 32-character id on the R2 overview page.

## 6. The first super admin

On your computer, with the production `DATABASE_URL` set in your terminal:

```bash
BOOTSTRAP_SUPER_ADMIN_EMAIL=you@media10.co.uk npm run bootstrap
```

It prints an invitation link that works for 48 hours. Open it, confirm
your email with the code you're sent, then set up two-factor sign-in.

## 7. Stripe (test mode first)

1. In the Stripe dashboard (in **test mode**), switch on **Connect** for the
   United Kingdom and fill in the platform profile. Suppliers will use the
   full Stripe dashboard and pay Stripe's fees themselves.
2. Put the **test** secret key (`sk_test_…`) into Vercel as
   `STRIPE_SECRET_KEY`, and the publishable key (`pk_test_…`) as
   `STRIPE_PUBLISHABLE_KEY`.
3. Add two webhook endpoints under Developers → Webhooks, and put each
   one's signing secret (`whsec_…`) into Vercel:

| Endpoint | Listen to | Events | Secret goes in |
| --- | --- | --- | --- |
| `https://<your address>/api/webhooks/stripe/connect` | Events on **connected accounts** | `account.updated` now; from phase 2 also `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `application_fee.refunded` | `STRIPE_CONNECT_WEBHOOK_SECRET` |
| `https://<your address>/api/webhooks/stripe/platform` | Events on **your account** | From phase 2: `setup_intent.succeeded`, `setup_intent.setup_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed` | `STRIPE_WEBHOOK_SECRET` |

4. Redeploy. On a supplier's Payments page, "Connect with Stripe" now goes
   to Stripe's own set-up pages. In test mode Stripe lets you use its test
   details (such as the test bank account `00012345`, sort code
   `108800`) without real ID.

Use **test keys only** until the pilot. A Stripe key without both webhook
secrets stops the site starting, on purpose: it would take money without
being able to confirm it. Without any Stripe key, a live site simply says
card payments aren't switched on yet; the payment simulator never runs on
a live address.

If a supplier says they've finished with Stripe but still shows Stripe
pending, open them under Suppliers and press "Check with Stripe".

## 8. Daily jobs

Vercel Cron calls `/api/cron/jobs` every 10 minutes (set in `vercel.json`).
Besides sending queued emails, once a day it removes expired sign-in data
and, from 8am, sends reminders about supplier documents that expire within
30 days. Reminder emails only go once Resend is set up.

## Before the pilot (for your accountant)

- VAT on Media10's commission.
- VAT invoices issued in suppliers' names.
- The supplier terms: refunds, delivery, disputes and data handling.
