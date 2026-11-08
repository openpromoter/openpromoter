import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

// Owners hear from OpenPromoter itself when a renewal fails or a paid plan ends, once per change.
const sent: { to: string; subject: string; body: string }[] = [];
vi.mock("@/server/email", () => ({
  sendNotice: async (to: string, subject: string, p: { paragraphs: string[]; cta?: { href: string } }) => {
    sent.push({ to, subject, body: `${p.paragraphs.join(" ")} ${p.cta?.href}` });
    return { delivered: true };
  },
}));

const { applyPlanSubscription, planStatus } = await import("@/server/billing-plans");
const { fixture } = await import("./helpers");

const sub = (wsId: string, status: string) =>
  ({
    id: "sub_m",
    customer: "cus_m",
    status,
    metadata: { workspace_id: wsId, plan: "starter" },
    trial_end: null,
    cancel_at: null,
    cancel_at_period_end: false,
    items: { data: [{ price: { lookup_key: "openpromoter_starter_monthly" }, current_period_end: 0 }] },
  }) as unknown as Stripe.Subscription;

describe("billing mail", () => {
  it("failed renewal mails once, then the end of retries mails that the plan ended and data is kept", async () => {
    const f = await fixture();
    sent.length = 0;
    await applyPlanSubscription(sub(f.ws.id, "active"));
    expect(sent).toEqual([]);
    await applyPlanSubscription(sub(f.ws.id, "past_due"));
    await applyPlanSubscription(sub(f.ws.id, "past_due")); // retried webhook: no second mail
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("payment didn't go through");
    expect(sent[0]!.body).toContain("/settings/billing");
    await applyPlanSubscription(sub(f.ws.id, "canceled"));
    await applyPlanSubscription(sub(f.ws.id, "canceled"));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toContain("Starter plan has ended");
    expect(sent[1]!.body).toContain("Nothing was deleted");
    expect((await planStatus(f.ws.id)).plan.id).toBe("free");
  });

  it("a plan the founder canceled mails once when it ends", async () => {
    const f = await fixture();
    sent.length = 0;
    await applyPlanSubscription(sub(f.ws.id, "active"));
    await applyPlanSubscription(sub(f.ws.id, "canceled"));
    expect(sent.map((m) => m.subject)).toEqual(["Your OpenPromoter Starter plan has ended"]);
  });
});
