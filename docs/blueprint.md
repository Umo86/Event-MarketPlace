# Event MarketPlace and BluePrint

How BluePrint, the exhibitor manual, works with a show's marketplace. The
marketplace never calls BluePrint: BluePrint sends everything, with one key
per show. Billie can use the same key to sign exhibitors in from a chat.

With BluePrint connected:

- **The exhibitor list stays up to date.** BluePrint sends the whole list
  whenever it changes. Nobody uploads spreadsheets.
- **Exhibitors are signed straight in.** A button in the manual opens the
  marketplace already signed in, with no code by email.

## 1. In Event MarketPlace

1. Open the show, then **Exhibitors → Connect BluePrint**.
2. Choose **Make a key** and copy it. It's shown once. The marketplace keeps
   only a hash of it, so nobody can read it back. If it's lost, make a new
   one: the old one stops working at once.

## 2. In BluePrint

Keep the key with that show's settings, encrypted like any other secret.
Use it only on BluePrint's server: never in a page, a browser or a log.

### Keep the exhibitor list up to date

Send the whole list whenever it changes, and once a night:

```
POST https://<marketplace address>/api/public/shows/<show-slug>/exhibitors
Authorization: Bearer <the show's key>
Content-Type: application/json
```

```json
{
  "exhibitors": [
    {
      "id": "ex_1042",
      "company": "Acme Displays Ltd",
      "stand": "B12",
      "hall": "Hall 1",
      "standType": "Shell scheme",
      "contacts": [
        { "name": "Sam Patel", "email": "sam@acme-displays.co.uk", "phone": "020 7946 0000" },
        { "name": "Ops desk", "email": "ops@acme-displays.co.uk" }
      ]
    }
  ]
}
```

- **The whole list, every time.** Contacts left out are removed from the
  marketplace's list and can no longer sign in. Their past orders are kept.
- **One entry per stand.** A company with two stands is two entries.
- **`contacts`**: the people who can sign in and order for that stand. The
  same email on the same stand keeps the same record, so a signed-in
  exhibitor stays signed in. Entries with no valid email are skipped.
- **`standType`** decides which services an exhibitor sees. Use the same
  names every time ("Shell scheme", "Space only").
- **`id`** (optional) is BluePrint's own id, kept for reference.
- Up to 5,000 contacts and 4 MB. Up to 60 updates an hour per show.

The answer when it worked (`200`):

```json
{ "contacts": 650, "added": 3, "updated": 12, "removed": 1, "skipped": 2 }
```

When it didn't, nothing changes, and `error` says what to do:

| Status | Why |
| --- | --- |
| `400` | The list isn't right: `error` says where, e.g. `Check exhibitors.3.stand: …` |
| `401` | The key is wrong, or it's been replaced. Make a new one. |
| `413` | Over 4 MB or 5,000 contacts. |
| `415` | Not sent as JSON. |
| `422` | No exhibitor has a usable email: an empty list is treated as a mistake. |
| `429` | Too many updates: wait a few minutes, then send the whole list again. |
| `500` | Something went wrong in the marketplace: try again in a minute. |

### Sign exhibitors straight in

When a signed-in exhibitor presses "Order services" in the manual, make a
fresh sign-in and send them to:

```
https://<marketplace address>/<show-slug>/sign-in/link#token=<SIGN-IN>
```

The sign-in always goes after the `#`. Browsers never send that part to a
server, so it never ends up in a log. Never put it in a query string.

The sign-in is a JWT, signed with HS256:

| Part | Value |
| --- | --- |
| Header `alg` | `HS256` (nothing else is accepted) |
| Header `kid` | The key's id: the 12 characters after `em_` |
| `iss` | `blueprint` (or `billie` from Billie) |
| `aud` | `event-marketplace` |
| `sub` | The exhibitor's email: one on the show's exhibitor list |
| `iat` | Now, in seconds |
| `exp` | When it stops working: 5 minutes on is right. At most 15 minutes after `iat` |
| `jti` | A random id. Each sign-in works once |

The secret is the SHA-256 of `event-marketplace-sign-in:` followed by the
key (the raw 32 bytes, not hex). In TypeScript, with nothing to install:

```ts
import { createHash, createHmac, randomUUID } from "node:crypto";

/** A sign-in for a show's marketplace, for an exhibitor signed in to the manual. */
export function marketplaceSignIn(key: string, email: string): string {
  const keyId = key.slice(3, 15); // the 12 characters after "em_"
  const now = Math.floor(Date.now() / 1000);
  const part = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const head = part({ alg: "HS256", typ: "JWT", kid: keyId });
  const body = part({
    iss: "blueprint",
    aud: "event-marketplace",
    sub: email.trim().toLowerCase(),
    iat: now,
    exp: now + 5 * 60,
    jti: randomUUID(),
  });
  const secret = createHash("sha256").update(`event-marketplace-sign-in:${key}`).digest();
  const signature = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${signature}`;
}
```

What the marketplace does with it:

- It signs in only that email, only if it's on that show's list, and only
  at that show. A sign-in for one show never works at another.
- The sign-in opens the storefront only. It can never open the admin or
  supplier areas, even if the same email belongs to a supplier.
- Each sign-in works once. Make a new one each time the button is pressed.
- If it doesn't work (run out, used, not on the list), the page says so in
  plain words and offers sign-in with an emailed code instead. It never
  says whether an email is on the list.
