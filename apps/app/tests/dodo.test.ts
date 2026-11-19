import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeDodo, verifyDodo } from "@/server/billing/dodo";
import { type Json, WebhookSignatureError } from "@/server/billing/types";

const key = randomBytes(24);
const secret = `whsec_${key.toString("base64")}`;
const sign = (body: string, id: string, ts: string, k: Buffer = key) =>
  `v1,${createHmac("sha256", k).update(`${id}.${ts}.${body}`).digest("base64")}`;
const now = () => String(Math.floor(Date.now() / 1000));

const payment = (over: Json = {}) => ({
  business_id: "bus_1",
  type: "payment.succeeded",
  timestamp: "2026-11-19T10:00:00Z",
  data: {
    payload_type: "Payment",
    payment_id: "pay_1",
    status: "succeeded",
    customer: { customer_id: "cus_1", email: "buyer@example.com", name: "Buyer" },
    subscription_id: "sub_1",
    total_amount: 2360,
    tax: 360,
    currency: "INR",
    settlement_amount: 2800,
    settlement_tax: 0,
    settlement_currency: "USD",
    metadata: { op_click: "clk_9" },
    discounts: [],
    product_cart: [{ product_id: "pdt_1", quantity: 1 }],
    created_at: "2026-11-19T10:00:00Z",
    ...over,
  },
});

describe("Dodo Payments webhooks", () => {
  it("verifies Standard Webhooks signatures and rejects bad or stale ones", () => {
    const body = JSON.stringify(payment());
    const ts = now();
    const parsed = verifyDodo(
      body,
      { id: "msg_1", timestamp: ts, signature: sign(body, "msg_1", ts) },
      secret,
    );
    expect(parsed.__id).toBe("msg_1");
    // a signature list with an unrelated entry first still verifies
    expect(() =>
      verifyDodo(
        body,
        { id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sign(body, "msg_1", ts)}` },
        secret,
      ),
    ).not.toThrow();
    expect(() => verifyDodo(body, { id: "msg_1", timestamp: ts, signature: "v1,AAAA" }, secret)).toThrow(
      WebhookSignatureError,
    );
    expect(() =>
      verifyDodo(`${body} `, { id: "msg_1", timestamp: ts, signature: sign(body, "msg_1", ts) }, secret),
    ).toThrow(WebhookSignatureError);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(() =>
      verifyDodo(body, { id: "msg_1", timestamp: old, signature: sign(body, "msg_1", old) }, secret),
    ).toThrow(WebhookSignatureError);
    expect(() => verifyDodo(body, { id: null, timestamp: ts, signature: "v1,x" }, secret)).toThrow(
      WebhookSignatureError,
    );
  });

  it("accepts a secret pasted without the whsec_ prefix", () => {
    const body = JSON.stringify(payment());
    const ts = now();
    expect(() =>
      verifyDodo(
        body,
        { id: "msg_2", timestamp: ts, signature: sign(body, "msg_2", ts) },
        key.toString("base64"),
      ),
    ).not.toThrow();
  });

  it("payment.succeeded books the sale before tax, with the settlement amount as base", () => {
    const parsed = normalizeDodo({ ...payment(), __id: "msg_1" });
    expect(parsed).toMatchObject({ eventId: "msg_1", eventType: "payment.succeeded", livemode: true });
    expect(parsed.events).toEqual([
      expect.objectContaining({
        type: "payment",
        paymentId: "pay_1",
        chargeIds: ["pay_1"],
        customerId: "cus_1",
        email: "buyer@example.com",
        subscriptionId: "sub_1",
        amount: 2000,
        currency: "inr",
        base: { currency: "usd", amount: 2800 },
        productId: "pdt_1",
        attribution: expect.objectContaining({ metadata: { op_click: "clk_9" }, email: "buyer@example.com" }),
      }),
    ]);
  });

  it("skips zero-amount payments and takes livemode from the connection", () => {
    expect(normalizeDodo(payment({ total_amount: 0, tax: 0 })).events).toEqual([]);
    expect(normalizeDodo(payment(), false).livemode).toBe(false);
  });

  it("reads the discount code and a multi-subscription payment's first subscription", () => {
    const ev = normalizeDodo(
      payment({
        subscription_id: null,
        subscription_ids: ["sub_a", "sub_b"],
        discounts: [{ discount_id: "dsc_1", code: "PARTNER20" }],
      }),
    ).events[0];
    expect(ev).toMatchObject({ subscriptionId: "sub_a", attribution: { promoCode: "PARTNER20" } });
  });

  it("refund.succeeded: a partial refund adds up, a full one reverses everything", () => {
    const refund = (data: Json) =>
      normalizeDodo({ type: "refund.succeeded", data: { refund_id: "ref_1", payment_id: "pay_1", ...data } })
        .events;
    expect(refund({ amount: 1180, is_partial: true })).toEqual([
      {
        type: "refund",
        chargeId: "pay_1",
        refundKey: "pay_1:ref_1",
        refunded: 1180,
        charged: 0,
        incremental: true,
      },
    ]);
    expect(refund({ amount: 2360, is_partial: false })).toEqual([
      { type: "refund", chargeId: "pay_1", refundKey: "pay_1:ref_1", refunded: 1, charged: 1 },
    ]);
    expect(refund({ amount: null, is_partial: true })).toEqual([]);
  });

  it("maps dispute statuses", () => {
    const dispute = (type: string, dispute_status: string) =>
      normalizeDodo({ type, data: { dispute_id: "dis_1", payment_id: "pay_1", dispute_status } }).events[0];
    expect(dispute("dispute.opened", "dispute_opened")).toMatchObject({ type: "dispute", status: "opened" });
    expect(dispute("dispute.lost", "dispute_lost")).toMatchObject({ status: "lost" });
    expect(dispute("dispute.accepted", "dispute_accepted")).toMatchObject({ status: "lost" });
    expect(dispute("dispute.won", "dispute_won")).toMatchObject({ status: "won", chargeId: "pay_1" });
  });

  it("subscriptions carry status and monthly MRR", () => {
    const sub = (type: string, over: Json = {}) =>
      normalizeDodo({
        type,
        timestamp: "2026-11-19T10:00:00Z",
        data: {
          subscription_id: "sub_1",
          customer: { customer_id: "cus_1" },
          status: "active",
          recurring_pre_tax_amount: 12000,
          currency: "USD",
          payment_frequency_interval: "Year",
          payment_frequency_count: 1,
          ...over,
        },
      }).events[0];
    expect(sub("subscription.active")).toMatchObject({
      type: "subscription",
      status: "active",
      mrr: 1000,
      currency: "usd",
      canceledAt: null,
    });
    expect(sub("subscription.on_hold", { status: "on_hold" })).toMatchObject({ status: "past_due" });
    expect(sub("subscription.paused", { status: "paused" })).toMatchObject({ status: "other", mrr: 0 });
    expect(
      sub("subscription.active", { payment_frequency_interval: "Month", recurring_pre_tax_amount: 900 }),
    ).toMatchObject({ mrr: 900 });
    const cancelled = sub("subscription.cancelled", {
      status: "cancelled",
      cancelled_at: "2026-11-20T00:00:00Z",
    });
    expect(cancelled).toMatchObject({ status: "canceled", mrr: 0 });
    expect((cancelled as { canceledAt: Date }).canceledAt.toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });

  it("ignores events it doesn't book", () => {
    expect(normalizeDodo({ type: "license_key.created", data: {} }).events).toEqual([]);
  });
});
