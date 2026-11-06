---
name: openpromoter
description: Add an OpenPromoter affiliate/referral program to this app (tracking script, signup tracking, Stripe Checkout attribution, webhooks). Use when the user asks to "add an affiliate program", "add referrals", "track partner sales" or mentions OpenPromoter.
---

# Add OpenPromoter to an app

OpenPromoter attributes signups and Stripe payments to partners. It needs three small changes. Never change prices, plans or billing logic.

## 1. Tracking script (every public page)

Add to the root layout `<head>` (Next.js: `app/layout.tsx`; plain HTML: every page):

```html
<script async src="{OPENPROMOTER_URL}/op.js" data-program="{PROGRAM_SLUG}"></script>
```

- EU sites that ask for cookie consent: add `data-consent="required"` and call `window.openpromoter("consent", true)` after the visitor accepts.
- Stripe Payment Links, Pricing Tables and Buy Buttons need nothing else: op.js adds `client_reference_id`.

## 2. Signup tracking

After a successful signup, record the lead. Browser:

```js
window.openpromoter?.signup({ email: user.email });
```

Or server-side with the SDK (`npm i openpromoter`), from the auth library's "user created" hook:

```ts
import { OpenPromoter, trackSignup } from "openpromoter";
const op = new OpenPromoter({ apiKey: process.env.OPENPROMOTER_API_KEY!, baseUrl: process.env.OPENPROMOTER_URL });
await trackSignup(op, { programId: process.env.OPENPROMOTER_PROGRAM_ID!, email: user.email, cookieHeader: request.headers.get("cookie") });
```

Hooks: Better Auth `databaseHooks.user.create.after`, NextAuth/Auth.js `events.createUser`, Clerk `user.created` webhook, Supabase `auth.users` insert trigger or the signup server action.

## 3. Stripe Checkout attribution (server)

Wherever the app calls `stripe.checkout.sessions.create`, spread the attribution params:

```ts
import { readReferralCookie, stripeCheckoutParams } from "openpromoter";
const session = await stripe.checkout.sessions.create({
  ...existingParams,
  ...stripeCheckoutParams(readReferralCookie(request.headers.get("cookie"))),
});
```

If the app already sets `metadata` or `subscription_data`, merge the objects instead of overwriting them.

## 4. Other billing (Paddle, Lemon Squeezy, Polar)

Pass `op_click` (from `window.openpromoter.clickId`) as checkout custom data: Paddle `customData`, Lemon Squeezy `checkout[custom][op_click]`, Polar checkout `metadata`. For anything else, call `op.conversions.create(...)` after each successful payment.

## Environment variables to add

```
OPENPROMOTER_URL=https://app.openpromoter.com   # or your self-hosted URL
OPENPROMOTER_API_KEY=op_sk_...                  # scope: tracking:write
OPENPROMOTER_PROGRAM_ID=prg_...
```

## Verify

Load the site once: the OpenPromoter dashboard (Settings → Install) shows "Script seen". Then open `{OPENPROMOTER_URL}/r/{PROGRAM_SLUG}/{partner-code}` and complete a test-mode checkout: a commission appears under Commissions within seconds.
