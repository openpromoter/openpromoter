import { workspace } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { PLANS } from "@/lib/plans";
import { stripeClient, verifyStripe } from "@/server/billing/stripe";
import { WebhookSignatureError } from "@/server/billing/types";
import { db } from "@/server/db";
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
  if (evt.type.startsWith("customer.subscription.")) {
    let sub = evt.data.object as Stripe.Subscription;
    const wsId = sub.metadata.workspace_id;
    const [ws] = wsId ? await db().select().from(workspace).where(eq(workspace.id, wsId)) : [];
    // an event for an older or duplicate subscription must not change the current one
    if (ws && (!ws.billingSubscriptionId || ws.billingSubscriptionId === sub.id)) {
      // events arrive in any order: read the subscription as it is now
      if (env.PLATFORM_STRIPE_SECRET_KEY)
        sub = await stripeClient(env.PLATFORM_STRIPE_SECRET_KEY).subscriptions.retrieve(sub.id);
      const active = ["active", "trialing", "past_due"].includes(sub.status);
      // the price says which plan it is; portal upgrades change the price, not the metadata
      const key = sub.items.data[0]?.price.lookup_key ?? "";
      const plan =
        PLANS.find((p) => key.startsWith(`openpromoter_${p.id}_`))?.id ?? sub.metadata.plan ?? "starter";
      await db()
        .update(workspace)
        .set({
          plan: active ? plan : "free",
          billingSubscriptionId: sub.id,
          billingCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        })
        .where(eq(workspace.id, ws.id));
    }
  }
  return Response.json({ received: true });
}
