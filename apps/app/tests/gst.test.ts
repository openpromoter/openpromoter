import { workspace } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

// India GST on Cloud plans: which rates a buyer gets, that Checkout charges them from the first payment,
// and that the address typed at Checkout corrects renewals.
let lastCheckout: Record<string, unknown> = {};
const updates: Record<string, unknown>[] = [];
vi.mock("@/server/billing/stripe", () => ({
  stripeClient: () => ({
    prices: { list: async () => ({ data: [{ id: "price_x" }] }) },
    checkout: {
      sessions: {
        create: async (p: Record<string, unknown>) => {
          lastCheckout = p;
          return { url: "https://checkout.test" };
        },
      },
    },
  }),
}));
vi.mock("@/server/env", async (orig) => {
  const m = await orig<typeof import("@/server/env")>();
  return {
    ...m,
    env: {
      ...m.env,
      PLATFORM_STRIPE_SECRET_KEY: "sk_test_x",
      GST_TAX_RATE_CGST: "txr_cgst",
      GST_TAX_RATE_SGST: "txr_sgst",
      GST_TAX_RATE_IGST: "txr_igst",
      GST_HOME_STATE: "UP",
    },
  };
});

const { checkoutUrl, planStatus, setBillingRegion, syncGst } = await import("@/server/billing-plans");
const { gstRates, outsideIndia, regionOf } = await import("@/server/gst");
const { db } = await import("@/server/db");
const { fixture } = await import("./helpers");

const fakeStripe = (address: Stripe.Address | null) =>
  ({
    customers: { retrieve: async () => ({ id: "cus_1", address }) },
    subscriptions: {
      update: async (_id: string, p: Record<string, unknown>) => {
        updates.push(p);
        return {};
      },
    },
  }) as unknown as Stripe;
const addr = (country: string, state = "") =>
  ({ country, state, city: null, line1: null, line2: null, postal_code: null }) as Stripe.Address;

describe("India GST on plans", () => {
  it("Uttar Pradesh pays CGST + SGST, other states IGST, abroad nothing", () => {
    expect(gstRates("in_home")).toEqual(["txr_cgst", "txr_sgst"]);
    expect(gstRates("in_other")).toEqual(["txr_igst"]);
    expect(gstRates("abroad")).toEqual([]);
    expect(regionOf(addr("IN", "UP"))).toBe("in_home");
    expect(regionOf(addr("IN", "Uttar Pradesh"))).toBe("in_home");
    expect(regionOf(addr("IN", "MH"))).toBe("in_other");
    expect(regionOf(addr("US", "CA"))).toBe("abroad");
    expect(regionOf(null)).toBeNull();
  });

  it("only visitors Cloudflare places outside India skip the billing location question", () => {
    expect(outsideIndia("US")).toBe(true);
    expect(outsideIndia("gb")).toBe(true);
    for (const c of ["IN", "XX", "T1", "", null, undefined, "garbage"]) expect(outsideIndia(c)).toBe(false);
  });

  it("Checkout waits for the billing location, then charges GST from the first payment", async () => {
    const f = await fixture();
    await expect(checkoutUrl(f.ws.id, "starter", "a@b.test")).rejects.toThrow("billed");
    // a visitor outside India skips the question: billed abroad, no GST
    const g = await fixture();
    await checkoutUrl(g.ws.id, "starter", "a@b.test", "/app", true);
    expect((lastCheckout.subscription_data as Record<string, unknown>).default_tax_rates).toBeUndefined();
    expect((await planStatus(g.ws.id)).region).toBe("abroad");
    await setBillingRegion(f.ws.id, "in_home");
    await checkoutUrl(f.ws.id, "starter", "a@b.test");
    const sub = lastCheckout.subscription_data as Record<string, unknown>;
    expect(sub.default_tax_rates).toEqual(["txr_cgst", "txr_sgst"]);
    expect(lastCheckout.billing_address_collection).toBe("required");
    expect(lastCheckout.tax_id_collection).toEqual({ enabled: true });
    await setBillingRegion(f.ws.id, "abroad");
    await checkoutUrl(f.ws.id, "starter", "a@b.test");
    expect((lastCheckout.subscription_data as Record<string, unknown>).default_tax_rates).toBeUndefined();
  });

  it("the address typed at Checkout corrects the rates for renewals", async () => {
    const f = await fixture();
    await setBillingRegion(f.ws.id, "abroad");
    const sub = {
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      default_tax_rates: [],
      metadata: { workspace_id: f.ws.id },
    } as unknown as Stripe.Subscription;
    updates.length = 0;
    await syncGst(fakeStripe(addr("IN", "KA")), sub);
    expect(updates).toEqual([{ default_tax_rates: ["txr_igst"] }]);
    const [w] = await db().select().from(workspace).where(eq(workspace.id, f.ws.id));
    expect(w!.billingRegion).toBe("in_other");
    // already right: nothing to update
    updates.length = 0;
    await syncGst(fakeStripe(addr("IN", "KA")), {
      ...sub,
      default_tax_rates: [{ id: "txr_igst" }],
    } as unknown as Stripe.Subscription);
    expect(updates).toEqual([]);
  });
});
