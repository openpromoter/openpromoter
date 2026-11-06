import { workspace } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Stripe stand-in: records which billing surface was opened
const calls: string[] = [];
vi.mock("@/server/billing/stripe", () => ({
  stripeClient: () => ({
    prices: { list: async () => ({ data: [{ id: "price_x" }] }) },
    checkout: {
      sessions: { create: async () => (calls.push("checkout"), { url: "https://checkout.test" }) },
    },
    billingPortal: {
      sessions: { create: async () => (calls.push("portal"), { url: "https://portal.test" }) },
    },
  }),
}));
vi.mock("@/server/env", async (orig) => {
  const m = await orig<typeof import("@/server/env")>();
  return { ...m, env: { ...m.env, PLATFORM_STRIPE_SECRET_KEY: "sk_test_x" } };
});

const { checkoutUrl } = await import("@/server/billing-plans");
const { db } = await import("@/server/db");
const { fixture } = await import("./helpers");

describe("plan billing", () => {
  it("a paying workspace switching plans goes to the portal, never a second checkout", async () => {
    const f = await fixture();
    await db()
      .update(workspace)
      .set({ plan: "starter", billingSubscriptionId: "sub_1", billingCustomerId: "cus_1" })
      .where(eq(workspace.id, f.ws.id));
    calls.length = 0;
    expect(await checkoutUrl(f.ws.id, "growth", "a@b.test")).toBe("https://portal.test");
    expect(await checkoutUrl(f.ws.id, "free", "a@b.test")).toBe("https://portal.test");
    expect(calls).toEqual(["portal", "portal"]);
  });

  it("a free workspace gets checkout for a paid plan", async () => {
    const f = await fixture();
    calls.length = 0;
    expect(await checkoutUrl(f.ws.id, "starter", "a@b.test")).toBe("https://checkout.test");
    await expect(checkoutUrl(f.ws.id, "free", "a@b.test")).rejects.toThrow("Free plan");
    expect(calls).toEqual(["checkout"]);
  });
});
