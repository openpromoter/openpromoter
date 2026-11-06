import { commission, program, workspace } from "@openpromoter/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { PRODUCT } from "@/lib/config";
import { lookupKey, type PlanId, planById } from "@/lib/plans";
import { stripeClient } from "./billing/stripe";
import { db } from "./db";
import { env, isHosted } from "./env";

export async function monthlyUsage(workspaceId: string) {
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [row] = await db()
    .select({ revenue: sql<number>`coalesce(sum(${commission.saleAmount}),0)::bigint` })
    .from(commission)
    .innerJoin(program, eq(program.id, commission.programId))
    .where(and(eq(program.workspaceId, workspaceId), gte(commission.createdAt, start)));
  return Number(row?.revenue ?? 0);
}

/** Self-host has no limits. Cloud warns over the limit but never stops tracking or payouts. */
export async function planStatus(workspaceId: string) {
  const [ws] = await db().select().from(workspace).where(eq(workspace.id, workspaceId));
  const plan = planById(ws?.plan ?? "free");
  const usage = await monthlyUsage(workspaceId);
  return {
    hosted: isHosted(),
    plan,
    usage,
    over: isHosted() && usage > plan.revenueLimit,
    trialEndsAt: ws?.trialEndsAt ?? null,
  };
}

export async function checkoutUrl(workspaceId: string, planId: PlanId, email: string, returnPath = "/app") {
  if (!env.PLATFORM_STRIPE_SECRET_KEY)
    throw new Error("Billing isn't configured (PLATFORM_STRIPE_SECRET_KEY)");
  const [current] = await db().select().from(workspace).where(eq(workspace.id, workspaceId));
  // a paying workspace switches or cancels in the Stripe portal: a second Checkout would start a second subscription
  if (current?.billingSubscriptionId && current.plan !== "free") return portalUrl(workspaceId, returnPath);
  if (planId === "free") throw new Error("You're already on the Free plan");
  const stripe = stripeClient(env.PLATFORM_STRIPE_SECRET_KEY);
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey(planId)], limit: 1 });
  const price = prices.data[0];
  if (!price) throw new Error(`No Stripe price with lookup key ${lookupKey(planId)}`);
  const [ws] = await db().select().from(workspace).where(eq(workspace.id, workspaceId));
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price.id, quantity: 1 }],
    customer: ws?.billingCustomerId ?? undefined,
    customer_email: ws?.billingCustomerId ? undefined : email,
    client_reference_id: workspaceId,
    // The Stripe account is shared with other DevDiggers products: name this checkout without changing theirs.
    // Receipts and the terms line still show the legal seller, DevDiggers Technologies.
    branding_settings: {
      display_name: PRODUCT.name,
      button_color: "#2442F5",
      // served by the marketing site (openpromoter-site public/icon-512.png); until it is live Checkout shows the name only
      icon: { type: "url", url: `https://${PRODUCT.domain}/icon-512.png` },
    },
    subscription_data: {
      metadata: { workspace_id: workspaceId, plan: planId },
      trial_period_days: ws?.billingSubscriptionId ? undefined : 14,
    },
    success_url: `${env.APP_URL}${returnPath}?billing=success`,
    cancel_url: `${env.APP_URL}${returnPath}`,
  });
  return session.url!;
}

export async function portalUrl(workspaceId: string, returnPath = "/app") {
  if (!env.PLATFORM_STRIPE_SECRET_KEY) throw new Error("Billing isn't configured");
  const [ws] = await db().select().from(workspace).where(eq(workspace.id, workspaceId));
  if (!ws?.billingCustomerId) throw new Error("No subscription yet");
  const s = await stripeClient(env.PLATFORM_STRIPE_SECRET_KEY).billingPortal.sessions.create({
    customer: ws.billingCustomerId,
    return_url: `${env.APP_URL}${returnPath}`,
  });
  return s.url;
}
