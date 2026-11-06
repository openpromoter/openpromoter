import { createHmac } from "node:crypto";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { hmacHex } from "@/lib/crypto";
import { normalizeLemonSqueezy, verifyLemonSqueezy } from "@/server/billing/lemonsqueezy";
import { normalizePaddle, verifyPaddle } from "@/server/billing/paddle";
import { normalizePolar, verifyPolar } from "@/server/billing/polar";
import { invoiceFields, normalizeStripe, verifyStripe } from "@/server/billing/stripe";
import { type Json, WebhookSignatureError } from "@/server/billing/types";
import { signPayload } from "@/server/events";

describe("Stripe webhooks", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({
    id: "evt_1",
    type: "invoice.paid",
    livemode: false,
    data: {
      object: {
        id: "in_1",
        customer: "cus_1",
        amount_paid: 12000,
        tax: 2000,
        currency: "usd",
        charge: "ch_1",
        status_transitions: { paid_at: 1767225600 },
        lines: {
          data: [{ price: { recurring: { interval: "month", interval_count: 1 } }, description: "Pro" }],
        },
      },
    },
  });
  it("verifies signatures and rejects tampering", async () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const evt = await verifyStripe(payload, header, secret);
    expect(evt.id).toBe("evt_1");
    await expect(verifyStripe(`${payload} `, header, secret)).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(verifyStripe(payload, null, secret)).rejects.toBeInstanceOf(WebhookSignatureError);
  });
  it("normalizes invoice.paid excluding tax", async () => {
    const evt = await verifyStripe(
      payload,
      Stripe.webhooks.generateTestHeaderString({ payload, secret }),
      secret,
    );
    const parsed = await normalizeStripe(evt);
    expect(parsed.events[0]).toMatchObject({
      type: "payment",
      amount: 10000,
      chargeIds: ["ch_1"],
      interval: "month",
      customerId: "cus_1",
    });
  });
  it("reads the 2025+ invoice shape", () => {
    const f = invoiceFields({
      amount_paid: 5000,
      total_taxes: [{ amount: 500 }],
      parent: { subscription_details: { subscription: "sub_9", metadata: { op_ref: "pat" } } },
      payments: { data: [{ payment: { payment_intent: "pi_1" } }] },
      lines: { data: [{ pricing: {} }] },
    });
    expect(f).toMatchObject({
      subscription: "sub_9",
      amount: 4500,
      chargeIds: ["pi_1"],
      metadata: { op_ref: "pat" },
    });
  });
  it("maps refunds and disputes", async () => {
    const refund = await normalizeStripe({
      id: "evt_r",
      type: "charge.refunded",
      livemode: false,
      data: { object: { id: "ch_1", payment_intent: "pi_1", amount: 10000, amount_refunded: 4000 } },
    } as unknown as Stripe.Event);
    expect(refund.events).toHaveLength(2);
    expect(refund.events[0]).toMatchObject({ type: "refund", refunded: 4000, charged: 10000 });
    const lost = await normalizeStripe({
      id: "evt_d",
      type: "charge.dispute.closed",
      livemode: false,
      data: { object: { id: "dp_1", charge: "ch_1", status: "lost" } },
    } as unknown as Stripe.Event);
    expect(lost.events[0]).toMatchObject({ type: "dispute", status: "lost" });
  });
});

describe("Paddle, Lemon Squeezy, Polar", () => {
  it("Paddle signature + transaction.completed", () => {
    const body = JSON.stringify({
      event_id: "ntf_1",
      event_type: "transaction.completed",
      data: {
        id: "txn_1",
        customer_id: "ctm_1",
        currency_code: "USD",
        custom_data: { op_click: "clk_1" },
        details: { totals: { subtotal: "5000", discount: "0" } },
        items: [{ price: { billing_cycle: { interval: "month", frequency: 1 } } }],
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const header = `ts=${ts};h1=${hmacHex("pdl_secret", `${ts}:${body}`)}`;
    const parsed = normalizePaddle(verifyPaddle(body, header, "pdl_secret"));
    expect(parsed.events[0]).toMatchObject({
      type: "payment",
      amount: 5000,
      currency: "usd",
      attribution: { metadata: { op_click: "clk_1" } },
    });
    expect(() =>
      verifyPaddle(
        body,
        header.replace(/h1=(.)/, (_, c) => `h1=${c === "0" ? "1" : "0"}`),
        "pdl_secret",
      ),
    ).toThrow(WebhookSignatureError);
    expect(() => verifyPaddle(body, `ts=1;h1=${hmacHex("pdl_secret", `1:${body}`)}`, "pdl_secret")).toThrow(
      /tolerance/,
    );
  });
  it("Lemon Squeezy signature + order_created + refund", () => {
    const body = JSON.stringify({
      meta: { event_name: "order_created", custom_data: { op_ref: "pat" } },
      data: {
        id: "42",
        attributes: {
          status: "paid",
          customer_id: 7,
          subtotal: 3000,
          discount_total: 0,
          currency: "USD",
          user_email: "a@b.test",
          created_at: "2026-01-01T00:00:00Z",
        },
      },
    });
    const parsed = normalizeLemonSqueezy(verifyLemonSqueezy(body, hmacHex("ls_secret", body), "ls_secret"));
    expect(parsed.events[0]).toMatchObject({
      type: "payment",
      paymentId: "order_42",
      amount: 3000,
      customerId: "7",
    });
    expect(() => verifyLemonSqueezy(body, "bad", "ls_secret")).toThrow(WebhookSignatureError);
    const refund = normalizeLemonSqueezy({
      meta: { event_name: "order_refunded" },
      data: { id: "42", attributes: { refunded_amount: 3000, total: 3000 } },
    });
    expect(refund.events[0]).toMatchObject({ type: "refund", chargeId: "order_42" });
  });
  it("Polar standard-webhooks signature + order.paid", () => {
    const body = JSON.stringify({
      type: "order.paid",
      data: {
        id: "ord_1",
        customer_id: "c_1",
        net_amount: 2500,
        currency: "usd",
        metadata: { op_click: "clk_2" },
        product: { recurring_interval: "month", name: "Pro" },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from("polar_secret", "utf8"))
      .update(`msg_1.${ts}.${body}`)
      .digest("base64");
    const parsed = normalizePolar(
      verifyPolar(body, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, "polar_secret"),
    );
    expect(parsed.eventId).toBe("msg_1");
    expect(parsed.events[0]).toMatchObject({ type: "payment", amount: 2500, interval: "month" });
    expect(() =>
      verifyPolar(body, { id: "msg_1", timestamp: ts, signature: "v1,AAAA" }, "polar_secret"),
    ).toThrow(WebhookSignatureError);
  });
});

describe("outgoing webhook signatures", () => {
  it("t=<ts>,v1=<hmac(ts.body)>", () => {
    const sig = signPayload("whsec_x", '{"a":1}', 1700000000);
    expect(sig).toBe(`t=1700000000,v1=${hmacHex("whsec_x", '1700000000.{"a":1}')}`);
  });
});

import { normalizeChargebee, verifyChargebee } from "@/server/billing/chargebee";

describe("Chargebee", () => {
  it("basic auth + payment_succeeded + refund", () => {
    const body = JSON.stringify({
      id: "ev_1",
      event_type: "payment_succeeded",
      content: {
        transaction: {
          id: "txn_1",
          amount: 5000,
          currency_code: "USD",
          customer_id: "cb_c1",
          subscription_id: "cb_s1",
          date: 1767225600,
        },
        invoice: { id: "inv_1", sub_total: 5000 },
        customer: { meta_data: { op_click: "clk_9" } },
        subscription: { billing_period_unit: "month", billing_period: 1 },
      },
    });
    const auth = `Basic ${Buffer.from("op:secret").toString("base64")}`;
    const parsed = normalizeChargebee(verifyChargebee(body, auth, "op:secret"));
    expect(parsed.events[0]).toMatchObject({
      type: "payment",
      paymentId: "inv_1",
      amount: 5000,
      attribution: { metadata: { op_click: "clk_9" } },
    });
    expect(() => verifyChargebee(body, "Basic bad", "op:secret")).toThrow(WebhookSignatureError);
    const refund = normalizeChargebee({
      id: "ev_2",
      event_type: "payment_refunded",
      content: {
        transaction: { id: "txn_r", amount: 2000, reference_transaction_id: "txn_1" },
        invoice: { total: 5000 },
      },
    });
    expect(refund.events[0]).toMatchObject({
      type: "refund",
      chargeId: "txn_1",
      refunded: 2000,
      charged: 5000,
    });
  });
});

describe("provider fixes", () => {
  const ts = () => String(Math.floor(Date.now() / 1000));
  const polarBody = JSON.stringify({ type: "order.paid", data: { id: "ord_2" } });
  const sign = (key: Buffer, t: string) =>
    createHmac("sha256", key).update(`msg_2.${t}.${polarBody}`).digest("base64");

  it("Polar accepts Standard Webhooks secrets (on or after 8 Sep 2026) and legacy ones", () => {
    const raw = Buffer.from("0123456789abcdef0123456789abcdef");
    const secret = `whsec_${raw.toString("base64")}`;
    const t = ts();
    // new secrets: the library base64-decodes the part after whsec_
    expect(() =>
      verifyPolar(polarBody, { id: "msg_2", timestamp: t, signature: `v1,${sign(raw, t)}` }, secret),
    ).not.toThrow();
    // legacy secrets: the key is the UTF-8 bytes of the whole whsec_ string
    expect(() =>
      verifyPolar(
        polarBody,
        { id: "msg_2", timestamp: t, signature: `v1,${sign(Buffer.from(secret, "utf8"), t)}` },
        secret,
      ),
    ).not.toThrow();
  });

  const lsInvoice = (billing_reason: string, custom_data?: Json) => ({
    meta: { event_name: "subscription_payment_success", custom_data },
    data: {
      id: "9",
      attributes: { billing_reason, customer_id: 7, subscription_id: 3, subtotal: 3000, currency: "USD" },
    },
  });

  it("Lemon Squeezy books the first subscription payment once (order_created owns it)", () => {
    expect(normalizeLemonSqueezy(lsInvoice("initial")).events).toEqual([]);
    expect(normalizeLemonSqueezy(lsInvoice("renewal")).events[0]).toMatchObject({
      type: "payment",
      paymentId: "subinv_9",
      interval: "month",
    });
    expect(normalizeLemonSqueezy(lsInvoice("renewal", { interval: "year" })).events[0]).toMatchObject({
      interval: "year",
    });
  });

  it("Paddle, Polar and Chargebee take livemode from the connection", () => {
    expect(normalizePaddle({ event_id: "e", event_type: "x", data: {} }, false).livemode).toBe(false);
    expect(normalizePolar({ type: "x", data: {} }, false).livemode).toBe(false);
    expect(normalizeChargebee({ id: "e", event_type: "x", content: {} }, false).livemode).toBe(false);
    expect(normalizePaddle({ event_id: "e", event_type: "x", data: {} }).livemode).toBe(true);
  });

  it("Paddle chargebacks: warning holds, chargeback reverses, reverse releases", () => {
    const adj = (action: string) =>
      normalizePaddle({
        event_id: `e_${action}`,
        event_type: "adjustment.created",
        data: { id: `adj_${action}`, action, status: "approved", transaction_id: "txn_1" },
      }).events[0];
    expect(adj("chargeback_warning")).toMatchObject({ type: "dispute", chargeId: "txn_1", status: "opened" });
    expect(adj("chargeback")).toMatchObject({ type: "dispute", status: "lost" });
    expect(adj("chargeback_reverse")).toMatchObject({ type: "dispute", status: "won" });
  });

  it("Chargebee chargeback events map to dispute opened, won and lost", () => {
    const cb = (event_type: string) =>
      normalizeChargebee({
        id: `ev_${event_type}`,
        event_type,
        content: { dispute: { id: "dp_1", transaction_id: "txn_1" }, transaction: { id: "txn_1" } },
      }).events[0];
    expect(cb("chargeback_initiated")).toMatchObject({
      type: "dispute",
      chargeId: "txn_1",
      disputeId: "dp_1",
      status: "opened",
    });
    expect(cb("chargeback_won")).toMatchObject({ status: "won" });
    expect(cb("chargeback_lost")).toMatchObject({ status: "lost" });
  });
});

import { billingConnection } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { SYSTEM } from "@/server/audit";
import { db } from "@/server/db";
import { setWebhookSecret } from "@/server/stripe-service";
import { fixture } from "./helpers";

describe("connection sandbox switch", () => {
  it("stores livemode from the Sandbox switch", async () => {
    const f = await fixture();
    const row = async () =>
      (
        await db()
          .select()
          .from(billingConnection)
          .where(and(eq(billingConnection.workspaceId, f.ws.id), eq(billingConnection.provider, "paddle")))
      )[0];
    await setWebhookSecret(f.ws.id, "paddle", "pdl_secret_1", SYSTEM, null, false);
    expect((await row())?.livemode).toBe(false);
    await setWebhookSecret(f.ws.id, "paddle", "pdl_secret_1", SYSTEM, null, true);
    expect((await row())?.livemode).toBe(true);
  });
});

describe("stripe invoice_payment.paid", () => {
  it("links the invoice to the payment intent it was paid with", async () => {
    // shape from a real test-mode event, API 2025-08-27.basil
    const evt = {
      id: "evt_ip",
      type: "invoice_payment.paid",
      livemode: false,
      data: {
        object: {
          id: "inpay_1",
          object: "invoice_payment",
          invoice: "in_1UYRpc",
          payment: { type: "payment_intent", payment_intent: "pi_3UYRpd" },
          status: "paid",
        },
      },
    } as unknown as Stripe.Event;
    const parsed = await normalizeStripe(evt);
    expect(parsed.events).toEqual([
      { type: "charge_link", paymentId: "in_1UYRpc", chargeIds: ["pi_3UYRpd"] },
    ]);
  });
});
