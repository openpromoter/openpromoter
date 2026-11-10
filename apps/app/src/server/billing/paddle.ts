import { hmacHex, safeEqual } from "@/lib/crypto";
import {
  assertFresh,
  type BillingEvent,
  type Json,
  type ParsedWebhook,
  strRecord,
  toDate,
  WebhookSignatureError,
} from "./types";

/** Paddle Billing: Paddle-Signature "ts=...;h1=..." = HMAC-SHA256(secret, `${ts}:${body}`). */
export function verifyPaddle(rawBody: string, header: string | null, secret: string, now = Date.now()): Json {
  if (!header) throw new WebhookSignatureError("Missing Paddle-Signature header");
  const parts = Object.fromEntries(header.split(";").map((p) => p.split("=") as [string, string]));
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) throw new WebhookSignatureError("Malformed Paddle-Signature header");
  assertFresh(ts, now);
  if (!safeEqual(hmacHex(secret, `${ts}:${rawBody}`), h1))
    throw new WebhookSignatureError("Invalid Paddle signature");
  return JSON.parse(rawBody);
}

/** Paddle payloads carry no sandbox flag, so `livemode` comes from the connection's Sandbox setting. */
/** Paddle adjustment actions: an early warning holds, a chargeback without one reverses, a won contest releases. */
const PADDLE_DISPUTE = {
  chargeback_warning: "opened",
  chargeback: "lost",
  chargeback_reverse: "won",
} as const;

export function normalizePaddle(body: Json, livemode = true): ParsedWebhook {
  const d = body.data ?? {};
  const events: BillingEvent[] = [];
  const custom = strRecord(d.custom_data);
  switch (body.event_type) {
    case "customer.created":
      events.push({
        type: "customer",
        customerId: d.id,
        email: d.email ?? null,
        name: d.name ?? null,
        attribution: { metadata: custom, email: d.email },
        createdAt: toDate(d.created_at),
      });
      break;
    case "transaction.completed": {
      const totals = d.details?.totals ?? {};
      const amount = Number(totals.subtotal ?? 0) - Number(totals.discount ?? 0);
      const price = d.items?.[0]?.price ?? {};
      if (d.customer_id && amount > 0) {
        events.push({
          type: "payment",
          paymentId: d.id,
          chargeIds: [d.id],
          customerId: d.customer_id,
          email: null,
          subscriptionId: d.subscription_id ?? null,
          amount,
          currency: String(d.currency_code ?? "usd").toLowerCase(),
          interval: price.billing_cycle?.interval ?? null,
          intervalCount: price.billing_cycle?.frequency ?? 1,
          paidAt: toDate(d.billed_at ?? d.updated_at),
          // webhooks carry only discount_id; it matches a partner code whose external id is that Paddle discount
          attribution: { metadata: custom, promoCode: d.discount?.code ?? d.discount_id ?? null },
          description: price.description ?? "Paddle transaction",
          priceId: price.id ?? null,
          productId: price.product_id ?? null,
        });
      }
      break;
    }
    case "adjustment.created":
    case "adjustment.updated":
      if (d.action === "refund" && d.status === "approved") {
        const refunded = Number(d.totals?.subtotal ?? d.totals?.total ?? 0);
        events.push({
          type: "refund",
          chargeId: d.transaction_id,
          refundKey: d.id,
          refunded,
          // an adjustment carries only its own amount: OpenPromoter adds earlier refunds and uses the sale amount
          charged: 0,
          incremental: true,
        });
      } else if (Object.hasOwn(PADDLE_DISPUTE, d.action ?? "")) {
        // ponytail: a chargeback_reverse after a plain chargeback (no warning) finds the commission already
        // reversed and leaves it reversed; a won dispute does not restore it.
        events.push({
          type: "dispute",
          chargeId: d.transaction_id,
          disputeId: d.id,
          status: PADDLE_DISPUTE[d.action as keyof typeof PADDLE_DISPUTE],
        });
      }
      break;
    case "subscription.created":
    case "subscription.updated":
    case "subscription.canceled":
      events.push({
        type: "subscription",
        subscriptionId: d.id,
        customerId: d.customer_id,
        status:
          d.status === "canceled"
            ? "canceled"
            : d.status === "trialing"
              ? "trialing"
              : d.status === "active"
                ? "active"
                : d.status === "past_due"
                  ? "past_due"
                  : "other",
        mrr: 0,
        canceledAt: d.canceled_at ? toDate(d.canceled_at) : null,
      });
      break;
  }
  return {
    eventId: body.event_id ?? body.notification_id,
    eventType: body.event_type,
    livemode,
    events,
  };
}
