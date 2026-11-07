import type Stripe from "stripe";
import { stripeClient, verifyStripe } from "@/server/billing/stripe";
import { WebhookSignatureError } from "@/server/billing/types";
import { applyPlanSubscription } from "@/server/billing-plans";
import { env } from "@/server/env";

export const runtime = "nodejs";

/** Cloud edition: OpenPromoter's own subscription events. */
export async function POST(req: Request) {
  if (!env.PLATFORM_STRIPE_WEBHOOK_SECRET) return Response.json({ error: "Not configured" }, { status: 404 });
  let evt: Stripe.Event;
  try {
    evt = await verifyStripe(
      await req.text(),
      req.headers.get("stripe-signature"),
      env.PLATFORM_STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    if (err instanceof WebhookSignatureError)
      return Response.json({ error: "Invalid signature" }, { status: 400 });
    throw err;
  }
  let sub = evt.data.object as Stripe.Subscription;
  // the Stripe account is shared with other DevDiggers products: only OpenPromoter plans carry workspace_id
  if (evt.type.startsWith("customer.subscription.") && sub.metadata?.workspace_id) {
    // events arrive in any order: read the subscription as it is now
    if (env.PLATFORM_STRIPE_SECRET_KEY)
      sub = await stripeClient(env.PLATFORM_STRIPE_SECRET_KEY).subscriptions.retrieve(sub.id);
    await applyPlanSubscription(sub);
  }
  return Response.json({ received: true });
}
