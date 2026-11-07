import { commission, program, workspace } from "@openpromoter/db";
import { and, eq, gte, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { PRODUCT } from "@/lib/config";
import { lookupKey, PLANS, type PlanId, planById } from "@/lib/plans";
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
    status: ws?.billingStatus ?? null,
    trialEndsAt: ws?.billingStatus === "trialing" ? ws.trialEndsAt : null,
    cancelAt: ws?.billingCancelAt ?? null,
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
    ...(env.PLATFORM_STRIPE_PORTAL_CONFIG ? { configuration: env.PLATFORM_STRIPE_PORTAL_CONFIG } : {}),
  });
  return s.url;
}

/** Ends a workspace's plan at once, used when the workspace itself is deleted so the card stops being charged. */
export async function cancelPlan(workspaceId: string) {
  if (!env.PLATFORM_STRIPE_SECRET_KEY) return;
  const [ws] = await db().select().from(workspace).where(eq(workspace.id, workspaceId));
  if (!ws?.billingSubscriptionId) return;
  const stripe = stripeClient(env.PLATFORM_STRIPE_SECRET_KEY);
  try {
    const sub = await stripe.subscriptions.retrieve(ws.billingSubscriptionId);
    if (sub.status !== "canceled") await stripe.subscriptions.cancel(sub.id);
  } catch (e) {
    // already gone in Stripe: nothing left to charge
    if ((e as { code?: string }).code !== "resource_missing") throw e;
  }
}

const at = (sec: number | null | undefined) => (sec ? new Date(sec * 1000) : null);

/**
 * Applies a plan subscription (as Stripe has it now) to its workspace. Called by the platform webhook.
 * past_due keeps the plan while Stripe retries the card; anything not active, trialing or past_due is Free.
 */
export async function applyPlanSubscription(sub: Stripe.Subscription) {
  const wsId = sub.metadata?.workspace_id;
  const [ws] = wsId ? await db().select().from(workspace).where(eq(workspace.id, wsId)) : [];
  if (!ws) return false; // deleted workspace, or not one of ours
  const active = ["active", "trialing", "past_due"].includes(sub.status);
  // An event for another subscription must not change the current one, except a new live subscription
  // replacing an ended one: a founder who canceled and subscribes again gets a new subscription id.
  const current = !ws.billingSubscriptionId || ws.billingSubscriptionId === sub.id;
  if (!current && !(ws.plan === "free" && active)) return false;
  // the price says which plan it is; portal upgrades change the price, not the metadata
  const key = sub.items?.data?.[0]?.price?.lookup_key ?? "";
  const plan =
    PLANS.find((p) => key.startsWith(`openpromoter_${p.id}_`))?.id ?? sub.metadata?.plan ?? "starter";
  const periodEnd = sub.items?.data?.[0]?.current_period_end;
  await db()
    .update(workspace)
    .set({
      plan: active ? plan : "free",
      billingSubscriptionId: sub.id,
      billingCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      billingStatus: sub.status,
      trialEndsAt: at(sub.trial_end),
      billingCancelAt: active ? at(sub.cancel_at ?? (sub.cancel_at_period_end ? periodEnd : null)) : null,
    })
    .where(eq(workspace.id, ws.id));
  return true;
}
