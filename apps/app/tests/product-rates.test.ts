import { commission } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { normalizeChargebee } from "@/server/billing/chargebee";
import { normalizeLemonSqueezy } from "@/server/billing/lemonsqueezy";
import { normalizePaddle } from "@/server/billing/paddle";
import { normalizePolar } from "@/server/billing/polar";
import { invoiceFields } from "@/server/billing/stripe";
import type { BillingEvent } from "@/server/billing/types";
import { computeCommission, productRateFor, resolvePlan } from "@/server/commission";
import { db } from "@/server/db";
import { ingest } from "@/server/ingest";
import { recordClick } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

const prog = {
  commissionType: "percent" as const,
  commissionValue: 3000,
  commissionDuration: "months" as const,
  commissionMonths: 12,
  commissionAfterValue: 1000,
};
const rates = [
  { id: "price_yearly", label: "Pro, $490.00/year", type: "percent" as const, value: 5000 },
  { id: "prod_addon", label: "Add-on", type: "fixed" as const, value: 700 },
];
const pay = (o: Partial<Parameters<typeof computeCommission>[1]> = {}) => ({
  amount: 10000,
  currency: "usd",
  paidAt: new Date("2026-03-01"),
  interval: "month",
  firstPaidAt: null,
  priorPayments: 0,
  ...o,
});

describe("product rates: matching and precedence", () => {
  it("matches the price id first, then the product id, else nothing", () => {
    expect(productRateFor(rates, { priceId: "price_yearly", productId: "prod_addon" })?.id).toBe(
      "price_yearly",
    );
    expect(productRateFor(rates, { priceId: "price_other", productId: "prod_addon" })?.id).toBe("prod_addon");
    expect(productRateFor(rates, { priceId: "price_other", productId: null })).toBeNull();
    expect(productRateFor(rates, {})).toBeNull();
    expect(productRateFor([], { priceId: "price_yearly" })).toBeNull();
  });

  it("partner override > product rate > tier > program", () => {
    const tier = { commissionType: "percent" as const, commissionValue: 4000 };
    const product = rates[0]!;
    expect(resolvePlan(prog, tier, 2000, product).value).toBe(2000);
    expect(resolvePlan(prog, tier, null, product).value).toBe(5000);
    expect(resolvePlan(prog, tier, null, null).value).toBe(4000);
    expect(resolvePlan(prog, null, null, null).value).toBe(3000);
  });

  it("a fixed product rate pays the amount and drops the percent step-down", () => {
    const plan = resolvePlan(prog, null, null, rates[1]);
    expect(plan).toMatchObject({ type: "fixed", value: 700, after: null });
    expect(computeCommission(plan, pay()).amount).toBe(700);
    // after the 12 months a fixed product rate stops: the later rate is a percent
    const late = pay({
      firstPaidAt: new Date("2025-01-01"),
      paidAt: new Date("2026-02-01"),
      priorPayments: 13,
    });
    expect(computeCommission(plan, late).eligible).toBe(false);
  });

  it("a percent product rate keeps the program's later rate after the first months", () => {
    const plan = resolvePlan(prog, null, null, rates[0]);
    expect(plan.after).toBe(1000);
    expect(computeCommission(plan, pay()).amount).toBe(5000);
    const late = pay({
      firstPaidAt: new Date("2025-01-01"),
      paidAt: new Date("2026-02-01"),
      priorPayments: 13,
    });
    expect(computeCommission(plan, late).amount).toBe(1000);
  });

  it("without a product rate the plan is unchanged (no regression)", () => {
    const tierFixed = { commissionType: "fixed" as const, commissionValue: 1500 };
    expect(resolvePlan(prog, tierFixed)).toMatchObject({ type: "fixed", value: 1500, after: null });
    expect(resolvePlan(prog, null, 2500)).toMatchObject({ type: "percent", value: 2500, after: 1000 });
    expect(resolvePlan({ ...prog, commissionType: "fixed" }, null, 900)).toMatchObject({
      type: "fixed",
      value: 900,
    });
  });
});

describe("payment events carry price and product ids", () => {
  it("Stripe 2025+ invoice lines (pricing.price_details)", () => {
    const f = invoiceFields({
      amount_paid: 5000,
      lines: { data: [{ pricing: { price_details: { price: "price_1", product: "prod_1" } } }] },
    });
    expect(f).toMatchObject({ priceId: "price_1", productId: "prod_1" });
  });
  it("Stripe pre-2025 invoice lines (price object)", () => {
    const f = invoiceFields({
      amount_paid: 5000,
      lines: {
        data: [
          { proration: true, price: { id: "price_old", product: "prod_old" } },
          { price: { id: "price_main", product: { id: "prod_main" }, recurring: { interval: "month" } } },
        ],
      },
    });
    expect(f).toMatchObject({ priceId: "price_main", productId: "prod_main" });
  });
  it("Paddle, Polar, Lemon Squeezy, Chargebee", () => {
    const paddle = normalizePaddle({
      event_type: "transaction.completed",
      data: {
        id: "txn_1",
        customer_id: "ctm_1",
        details: { totals: { subtotal: "5000", discount: "0" } },
        items: [{ price: { id: "pri_1", product_id: "pro_1" } }],
      },
    });
    expect(paddle.events[0]).toMatchObject({ priceId: "pri_1", productId: "pro_1" });

    const polar = normalizePolar({
      type: "order.paid",
      data: { id: "o1", customer_id: "c1", net_amount: 2500, product_id: "p1", product_price_id: "pp1" },
    });
    expect(polar.events[0]).toMatchObject({ priceId: "pp1", productId: "p1" });

    const ls = normalizeLemonSqueezy({
      meta: { event_name: "order_created" },
      data: {
        id: "42",
        attributes: {
          status: "paid",
          customer_id: 7,
          subtotal: 3000,
          first_order_item: { variant_id: 11, product_id: 22 },
        },
      },
    });
    expect(ls.events[0]).toMatchObject({ priceId: "11", productId: "22" });

    const cb = normalizeChargebee({
      id: "ev",
      event_type: "payment_succeeded",
      content: {
        transaction: { id: "t1", amount: 5000, customer_id: "c1" },
        invoice: {
          id: "i1",
          sub_total: 5000,
          line_items: [
            { entity_type: "addon_item_price", entity_id: "addon-USD" },
            { entity_type: "plan_item_price", entity_id: "pro-USD-monthly" },
          ],
        },
      },
    });
    expect(cb.events[0]).toMatchObject({ priceId: "pro-USD-monthly" });
  });
});

describe("product rates in the ledger", () => {
  it("books the product rate for a listed price and the program rate for others", async () => {
    const f = await fixture({ productRates: rates });
    const p = await addPartner(f.program.id, f.ws.id);
    const click = await recordClick({
      programId: f.program.id,
      code: p.code,
      landingUrl: `https://acme.test/?via=${p.code}`,
      userAgent: "Mozilla/5.0",
      ip: "1.2.3.4",
    });
    const evt = (events: BillingEvent[]) => ({
      eventId: `evt_${Math.random()}`,
      eventType: "test",
      livemode: false,
      events,
    });
    await ingest(
      f.ws.id,
      "stripe",
      evt([
        {
          type: "checkout",
          customerId: "cus_PR",
          email: "buyer@x.test",
          name: "Buyer",
          subscriptionId: "sub_PR",
          attribution: { clientReferenceId: click!.clickId },
        },
      ]),
    );
    const payment = (paymentId: string, priceId: string | null, productId: string | null): BillingEvent => ({
      type: "payment",
      paymentId,
      chargeIds: [`ch_${paymentId}`],
      customerId: "cus_PR",
      email: null,
      subscriptionId: "sub_PR",
      amount: 10000,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      paidAt: new Date(),
      attribution: {},
      description: "Pro plan",
      priceId,
      productId,
    });
    await ingest(f.ws.id, "stripe", evt([payment("in_a", "price_yearly", "prod_x")]));
    await ingest(f.ws.id, "stripe", evt([payment("in_b", "price_x", "prod_addon")]));
    await ingest(f.ws.id, "stripe", evt([payment("in_c", null, null)]));
    const rows = await db().select().from(commission).where(eq(commission.partnerId, p.id));
    const by = Object.fromEntries(rows.map((c) => [c.sourceKey, c.amount]));
    expect(by).toEqual({ "stripe:in_a": 5000, "stripe:in_b": 700, "stripe:in_c": 3000 });
  });
});
