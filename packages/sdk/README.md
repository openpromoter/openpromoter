# openpromoter

TypeScript SDK for [OpenPromoter](https://openpromoter.com), the open-source affiliate and referral platform for SaaS.

```bash
npm install openpromoter
```

```ts
import { OpenPromoter, trackSignup, stripeCheckoutParams, readReferralCookie, verifyWebhook } from "openpromoter";

const op = new OpenPromoter({ apiKey: process.env.OPENPROMOTER_API_KEY!, baseUrl: "https://app.openpromoter.com" });

// 1. after signup (any auth: Better Auth, NextAuth, Clerk, Supabase)
await trackSignup(op, { programId: "prg_...", email: user.email, cookieHeader: req.headers.get("cookie") });

// 2. when creating a Stripe Checkout Session, attribute without cookies
const ref = readReferralCookie(req.headers.get("cookie"));
const session = await stripe.checkout.sessions.create({ ...yourOptions, ...stripeCheckoutParams(ref) });

// 2b. give referred customers their discount automatically (your Stripe coupon id; leave out allow_promotion_codes)
const discounted = await stripe.checkout.sessions.create({
  ...yourOptions,
  ...stripeCheckoutParams(ref, { coupon: process.env.OPENPROMOTER_COUPON }),
});

// 3. other billing systems: report payments yourself (idempotent on paymentId)
await op.conversions.create({ programId: "prg_...", paymentId: "inv_1", customerId: "cus_1", amount: 4900, currency: "usd", interval: "month" });

// 4. verify webhooks
const event = verifyWebhook(rawBody, req.headers.get("openpromoter-signature"), process.env.OPENPROMOTER_WEBHOOK_SECRET!);
```

Payouts created with `op.payouts.prepare()` always wait for a person to approve them in the dashboard.

License: [MIT](LICENSE)
