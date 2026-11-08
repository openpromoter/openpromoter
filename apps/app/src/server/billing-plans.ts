import { commission, member, program, user, workspace } from "@openpromoter/db";
import { and, eq, gte, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { PRODUCT } from "@/lib/config";
import { lookupKey, PLANS, type PlanId, planById } from "@/lib/plans";
import { stripeClient } from "./billing/stripe";
import { db } from "./db";
import { sendNotice } from "./email";
import { env, isHosted } from "./env";
import { type BillingRegion, gstOn, gstRates, regionOf, sameRates } from "./gst";

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
    region: ws?.billingRegion ?? null,
    gst: gstOn(),
    trialEndsAt: ws?.billingStatus === "trialing" ? ws.trialEndsAt : null,
    cancelAt: ws?.billingCancelAt ?? null,
  };
}

export async function checkoutUrl(
  workspaceId: string,
  planId: PlanId,
  email: string,
  returnPath = "/app",
  /** the visitor is outside India (Cloudflare): no location question, billed abroad */
  outside = false,
) {
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
  // India GST is charged from the first payment, so where the business is billed is asked before Checkout
  let region = ws?.billingRegion ?? null;
  if (gstOn() && !region) {
    if (!outside) throw new Error("Choose where your business is billed first");
    region = "abroad";
    await setBillingRegion(workspaceId, region);
  }
  const tax = gstRates(region);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price.id, quantity: 1 }],
    customer: ws?.billingCustomerId ?? undefined,
    customer_email: ws?.billingCustomerId ? undefined : email,
    // the address decides GST for renewals (syncGst) and a GSTIN puts the buyer's tax id on the invoice
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    ...(ws?.billingCustomerId
      ? { customer_update: { name: "auto" as const, address: "auto" as const } }
      : {}),
    ...(gstOn()
      ? {
          custom_text: {
            submit: {
              message: tax.length
                ? "18% GST is added to each payment (CGST and SGST in Uttar Pradesh, IGST in other states)."
                : "No GST outside India. Indian businesses pay 18% GST on top.",
            },
          },
        }
      : {}),
    client_reference_id: workspaceId,
    // The Stripe account is shared with other DevDiggers products: name this checkout without changing theirs.
    // Receipts and the terms line still show the legal seller, DevDiggers Technologies.
    branding_settings: {
      display_name: PRODUCT.name,
      // the brand: white page, beacon blue button (the account default is a slate panel shared with other products)
      background_color: "#ffffff",
      button_color: "#2442F5",
      // the header logo (black bot, blue beacon) on white, padded for Stripe's round crop: public/checkout-icon.png
      icon: { type: "url", url: `${env.APP_URL}/checkout-icon.png` },
    },
    // no trial: the Free plan already has every feature, so a paid plan is charged the day it is chosen
    subscription_data: {
      metadata: { workspace_id: workspaceId, plan: planId },
      ...(tax.length ? { default_tax_rates: tax } : {}),
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
  const was = planById(ws.plan).name;
  if (sub.status === "past_due" && ws.billingStatus !== "past_due") await tellOwners(ws.id, "failed", was);
  else if (ws.plan !== "free" && !active)
    await tellOwners(ws.id, ws.billingStatus === "past_due" ? "unpaid" : "ended", was);
  return true;
}

/**
 * Mail to the workspace owners when a payment fails or a paid plan ends. Stripe's own mails come from the
 * shared DevDiggers account, so these carry the OpenPromoter name and link to Plan & billing.
 * Logged, not thrown: a mail problem must not undo the plan change.
 */
async function tellOwners(workspaceId: string, kind: "failed" | "ended" | "unpaid", plan: string) {
  try {
    const owners = await db()
      .select({ email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.workspaceId, workspaceId), eq(member.role, "owner")));
    const [prog] = await db()
      .select({ id: program.id })
      .from(program)
      .where(eq(program.workspaceId, workspaceId))
      .limit(1);
    const href = prog ? `${env.APP_URL}/app/${prog.id}/settings/billing` : `${env.APP_URL}/app`;
    const kept =
      "Nothing was deleted. Your partners, links, commissions and payouts are all kept, and tracking keeps working.";
    const mail =
      kind === "failed"
        ? {
            subject: `Your ${PRODUCT.name} payment didn't go through`,
            title: "Your payment didn't go through",
            paragraphs: [
              `We couldn't charge your card for the ${plan} plan. Stripe will try again over the next two weeks.`,
              "Update your card to keep the plan. Everything keeps working in the meantime.",
            ],
            cta: { label: "Update card", href },
          }
        : {
            subject: `Your ${PRODUCT.name} ${plan} plan has ended`,
            title: `Your ${plan} plan has ended`,
            paragraphs: [
              kind === "unpaid"
                ? "We couldn't charge your card after several tries. You're on the Free plan now."
                : "You're on the Free plan now.",
              kept,
              "Free covers up to $1k a month in partner revenue and shows the OpenPromoter badge on your portal. Choose a plan again any time.",
            ],
            cta: { label: "Choose a plan", href },
          };
    for (const o of owners)
      await sendNotice(o.email, mail.subject, {
        brandName: PRODUCT.name,
        preview: mail.title,
        title: mail.title,
        paragraphs: mail.paragraphs,
        cta: mail.cta,
      });
  } catch (e) {
    console.error(`[billing] ${kind} mail for ${workspaceId}: ${(e as Error).message}`);
  }
}

export async function setBillingRegion(workspaceId: string, region: BillingRegion) {
  await db().update(workspace).set({ billingRegion: region }).where(eq(workspace.id, workspaceId));
}

/**
 * After Checkout: the address the buyer typed is what counts for GST. If it falls in another region than
 * the one chosen in the app, renewals get the right rates and the workspace is corrected. The first
 * invoice already used the chosen region; the 18% total is the same inside India.
 */
export async function syncGst(stripe: Stripe, sub: Stripe.Subscription) {
  if (!gstOn() || !["active", "trialing", "past_due"].includes(sub.status)) return;
  const customer =
    typeof sub.customer === "string" ? await stripe.customers.retrieve(sub.customer) : sub.customer;
  if (!customer || customer.deleted) return;
  const region = regionOf(customer.address);
  if (!region) return;
  const want = gstRates(region);
  const have = (sub.default_tax_rates ?? []).map((r) => (typeof r === "string" ? r : r.id));
  if (!sameRates(want, have))
    await stripe.subscriptions.update(sub.id, { default_tax_rates: want.length ? want : ("" as never) });
  const wsId = sub.metadata?.workspace_id;
  if (wsId) await db().update(workspace).set({ billingRegion: region }).where(eq(workspace.id, wsId));
}
