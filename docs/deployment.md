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

## 7. Stripe (phase 1 onwards, test mode first)

1. In the Stripe dashboard, switch on **Connect** for the United Kingdom
   and fill in the platform profile.
2. Add two webhook endpoints (addresses and events will be listed here in
   phase 1), and put each signing secret into Vercel.
3. Use **test keys only** (`sk_test_…`) until the pilot.

A Stripe key without both webhook secrets stops the site starting, on
purpose: it would take money without being able to confirm it.

## Before the pilot (for your accountant)

- VAT on Media10's commission.
- VAT invoices issued in suppliers' names.
- The supplier terms: refunds, delivery, disputes and data handling.
