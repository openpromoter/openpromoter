import { hmacHex, safeEqual } from "@/lib/crypto";
import {
  type BillingEvent,
  type Json,
  type ParsedWebhook,
  strRecord,
  toDate,
  WebhookSignatureError,
} from "./types";

/** Lemon Squeezy: X-Signature = hex HMAC-SHA256(signing secret, raw body). */
export function verifyLemonSqueezy(rawBody: string, signature: string | null, secret: string): Json {
  if (!signature) throw new WebhookSignatureError("Missing X-Signature header");
  if (!safeEqual(hmacHex(secret, rawBody), signature))
    throw new WebhookSignatureError("Invalid Lemon Squeezy signature");
  return JSON.parse(rawBody);
}

export function normalizeLemonSqueezy(body: Json): ParsedWebhook {
  const name = body.meta?.event_name as string;
  const custom = strRecord(body.meta?.custom_data);
  const d = body.data ?? {};
  const a = d.attributes ?? {};
  const events: BillingEvent[] = [];
  switch (name) {
    case "order_created":
      if (a.status === "paid" && a.customer_id) {
        events.push({
          type: "payment",
          paymentId: `order_${d.id}`,
          chargeIds: [`order_${d.id}`],
          customerId: String(a.customer_id),
          email: a.user_email ?? null,
          subscriptionId: null,
          amount: Number(a.subtotal ?? 0) - Number(a.discount_total ?? 0),
          currency: String(a.currency ?? "usd").toLowerCase(),
          interval: null,
          intervalCount: 1,
          paidAt: toDate(a.created_at),
          attribution: { metadata: custom, email: a.user_email, promoCode: a.discount_code ?? null },
          description: a.first_order_item?.product_name ?? "Order",
          priceId: a.first_order_item?.variant_id != null ? String(a.first_order_item.variant_id) : null,
          productId: a.first_order_item?.product_id != null ? String(a.first_order_item.product_id) : null,
        });
      }
      break;
    case "subscription_payment_success":
      // order_created always fires for the first payment too, so booking the "initial" invoice would pay
      // the partner twice. ponytail: the first payment books without an interval, so MRR shows from the
      // first renewal; Lemon Squeezy gives no order id on the invoice to merge the two.
      if (a.billing_reason === "initial") break;
      events.push({
        type: "payment",
        paymentId: `subinv_${d.id}`,
        chargeIds: [`subinv_${d.id}`],
        customerId: String(a.customer_id),
        email: a.user_email ?? null,
        subscriptionId: String(a.subscription_id),
        amount: Number(a.subtotal ?? 0) - Number(a.discount_total ?? 0),
        currency: String(a.currency ?? "usd").toLowerCase(),
        interval: a.billing_reason === "renewal" ? (custom.interval ?? "month") : null,
        intervalCount: 1,
        paidAt: toDate(a.created_at),
        attribution: { metadata: custom, email: a.user_email },
        description: "Subscription payment",
      });
      break;
    case "order_refunded":
    case "subscription_payment_refunded": {
      const key = name === "order_refunded" ? `order_${d.id}` : `subinv_${d.id}`;
      events.push({
        type: "refund",
        chargeId: key,
        refundKey: `${key}:${a.refunded_amount}`,
        refunded: Number(a.refunded_amount ?? a.total ?? 0),
        charged: Number(a.total ?? 0),
      });
      break;
    }
    case "subscription_created":
    case "subscription_updated":
    case "subscription_cancelled":
    case "subscription_expired":
      events.push({
        type: "subscription",
        subscriptionId: String(d.id),
        customerId: String(a.customer_id),
        status:
          a.status === "on_trial"
            ? "trialing"
            : a.status === "active"
              ? "active"
              : ["cancelled", "expired"].includes(a.status)
                ? "canceled"
                : a.status === "past_due"
                  ? "past_due"
                  : "other",
        mrr: 0,
        canceledAt: a.ends_at && ["cancelled", "expired"].includes(a.status) ? toDate(a.ends_at) : null,
      });
      break;
  }
  return {
    eventId: `${name}:${d.id}:${a.updated_at ?? a.created_at ?? ""}`,
    eventType: name,
    livemode: !a.test_mode,
    events,
  };
}
