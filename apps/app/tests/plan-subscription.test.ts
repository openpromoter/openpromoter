import { workspace } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { applyPlanSubscription, planStatus } from "@/server/billing-plans";
import { db } from "@/server/db";
import { fixture } from "./helpers";

// Every state OpenPromoter's own plan subscription can reach in Stripe, applied the way the platform
// webhook applies it (after reading the subscription as it is now).
const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

function sub(
  wsId: string,
  over: Partial<Stripe.Subscription> & { lookup?: string; periodEnd?: number } = {},
) {
  const { lookup = "openpromoter_starter_monthly", periodEnd = now() + 30 * DAY, ...rest } = over;
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    metadata: { workspace_id: wsId, plan: "starter" },
    trial_end: null,
    cancel_at: null,
    cancel_at_period_end: false,
    items: { data: [{ price: { lookup_key: lookup }, current_period_end: periodEnd }] },
    ...rest,
  } as unknown as Stripe.Subscription;
}
const ws = async (id: string) => (await db().select().from(workspace).where(eq(workspace.id, id)))[0]!;

describe("plan subscription states", () => {
  it("trial: plan is on, the page shows when the trial ends", async () => {
    const f = await fixture();
    const end = now() + 14 * DAY;
    await applyPlanSubscription(sub(f.ws.id, { status: "trialing", trial_end: end }));
    const s = await planStatus(f.ws.id);
    expect(s.plan.id).toBe("starter");
    expect(s.status).toBe("trialing");
    expect(s.trialEndsAt?.getTime()).toBe(end * 1000);
  });

  it("trial converts to active: trial date clears", async () => {
    const f = await fixture();
    await applyPlanSubscription(sub(f.ws.id, { status: "trialing", trial_end: now() + DAY }));
    await applyPlanSubscription(sub(f.ws.id, { status: "active", trial_end: now() - 1 }));
    const s = await planStatus(f.ws.id);
    expect(s.status).toBe("active");
    expect(s.trialEndsAt).toBeNull();
  });

  it("failed renewal (past_due) keeps the plan while Stripe retries and flags it", async () => {
    const f = await fixture();
    await applyPlanSubscription(sub(f.ws.id, { status: "past_due" }));
    const s = await planStatus(f.ws.id);
    expect(s.plan.id).toBe("starter");
    expect(s.status).toBe("past_due");
  });

  it("retries exhausted (unpaid) or first payment never made (incomplete) means Free", async () => {
    for (const status of ["unpaid", "incomplete", "incomplete_expired", "paused"] as const) {
      const f = await fixture();
      await applyPlanSubscription(sub(f.ws.id, { status }));
      expect((await ws(f.ws.id)).plan).toBe("free");
    }
  });

  it("cancel at period end: plan stays until then and the end date shows", async () => {
    const f = await fixture();
    const end = now() + 10 * DAY;
    await applyPlanSubscription(sub(f.ws.id, { cancel_at_period_end: true, periodEnd: end }));
    let s = await planStatus(f.ws.id);
    expect(s.plan.id).toBe("starter");
    expect(s.cancelAt?.getTime()).toBe(end * 1000);
    // founder changes their mind in the portal
    await applyPlanSubscription(sub(f.ws.id, { cancel_at_period_end: false, periodEnd: end }));
    s = await planStatus(f.ws.id);
    expect(s.cancelAt).toBeNull();
  });

  it("subscription ends: Free, nothing scheduled", async () => {
    const f = await fixture();
    await applyPlanSubscription(sub(f.ws.id));
    await applyPlanSubscription(sub(f.ws.id, { status: "canceled", cancel_at: now() }));
    const w = await ws(f.ws.id);
    expect(w.plan).toBe("free");
    expect(w.billingCancelAt).toBeNull();
  });

  it("upgrade or downgrade in the portal follows the price, not the old metadata", async () => {
    const f = await fixture();
    await applyPlanSubscription(sub(f.ws.id));
    await applyPlanSubscription(sub(f.ws.id, { lookup: "openpromoter_growth_monthly" }));
    expect((await ws(f.ws.id)).plan).toBe("growth");
    await applyPlanSubscription(sub(f.ws.id, { lookup: "openpromoter_scale_monthly" }));
    expect((await ws(f.ws.id)).plan).toBe("scale");
    await applyPlanSubscription(sub(f.ws.id, { lookup: "openpromoter_starter_monthly" }));
    expect((await ws(f.ws.id)).plan).toBe("starter");
  });

  it("subscribing again after a cancellation upgrades the plan (new subscription id)", async () => {
    const f = await fixture();
    await applyPlanSubscription(sub(f.ws.id, { id: "sub_old" }));
    await applyPlanSubscription(sub(f.ws.id, { id: "sub_old", status: "canceled" }));
    expect((await ws(f.ws.id)).plan).toBe("free");
    await applyPlanSubscription(sub(f.ws.id, { id: "sub_new", lookup: "openpromoter_growth_monthly" }));
    const w = await ws(f.ws.id);
    expect(w.plan).toBe("growth");
    expect(w.billingSubscriptionId).toBe("sub_new");
    // a late event for the old subscription must not undo it
    expect(await applyPlanSubscription(sub(f.ws.id, { id: "sub_old", status: "canceled" }))).toBe(false);
    expect((await ws(f.ws.id)).plan).toBe("growth");
  });

  it("a second subscription while one is live is ignored", async () => {
    const f = await fixture();
    await applyPlanSubscription(sub(f.ws.id, { id: "sub_a" }));
    expect(
      await applyPlanSubscription(sub(f.ws.id, { id: "sub_b", lookup: "openpromoter_scale_monthly" })),
    ).toBe(false);
    expect((await ws(f.ws.id)).plan).toBe("starter");
  });

  it("subscriptions of other products or deleted workspaces change nothing", async () => {
    const other = sub("ws_missing");
    expect(await applyPlanSubscription(other)).toBe(false);
    const noMeta = { ...sub("x"), metadata: {} } as unknown as Stripe.Subscription;
    expect(await applyPlanSubscription(noMeta)).toBe(false);
  });
});
