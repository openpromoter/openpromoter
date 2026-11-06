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
const session = await stripe.checkout.sessions.create({ ...yourOptions, ...stripeCheckoutParams(readReferralCookie(req.headers.get("cookie"))) });

// 3. other billing systems: report payments yourself (idempotent on paymentId)
await op.conversions.create({ programId: "prg_...", paymentId: "inv_1", customerId: "cus_1", amount: 4900, currency: "usd", interval: "month" });

// 4. verify webhooks
const event = verifyWebhook(rawBody, req.headers.get("openpromoter-signature"), process.env.OPENPROMOTER_WEBHOOK_SECRET!);
```

Payouts created with `op.payouts.prepare()` always wait for a person to approve them in the dashboard.

License: [MIT](LICENSE)
