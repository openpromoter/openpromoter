import { safeEqual } from "@/lib/crypto";
import {
  type BillingEvent,
  type Json,
  type ParsedWebhook,
  strRecord,
  toDate,
  WebhookSignatureError,
} from "./types";

/** Chargebee webhooks authenticate with HTTP Basic auth configured on the endpoint ("user:password"). */
export function verifyChargebee(rawBody: string, authorization: string | null, secret: string): Json {
  const given = authorization?.startsWith("Basic ")
    ? Buffer.from(authorization.slice(6), "base64").toString()
    : "";
  if (!given || !safeEqual(given, secret)) throw new WebhookSignatureError("Invalid Chargebee basic auth");
  return JSON.parse(rawBody);
}

/** Chargebee payloads carry no test-site flag, so `livemode` comes from the connection's Sandbox setting. */
export function normalizeChargebee(body: Json, livemode = true): ParsedWebhook {
  const c = body.content ?? {};
  const events: BillingEvent[] = [];
  const md = {
    ...strRecord(c.customer?.meta_data),
    ...(c.customer?.cf_op_click ? { op_click: String(c.customer.cf_op_click) } : {}),
    ...strRecord(c.subscription?.meta_data),
  };
  switch (body.event_type) {
    case "customer_created":
      events.push({
        type: "customer",
        customerId: c.customer.id,
        email: c.customer.email ?? null,
        name: [c.customer.first_name, c.customer.last_name].filter(Boolean).join(" ") || null,
        attribution: { metadata: md, email: c.customer.email },
        createdAt: toDate(c.customer.created_at),
      });
      break;
    case "payment_succeeded": {
      const t = c.transaction ?? {};
      const inv = c.invoice ?? {};
      const amount =
        Number(inv.sub_total ?? t.amount ?? 0) -
        Number(inv.discounts?.reduce?.((a: number, d: Json) => a + Number(d.amount ?? 0), 0) ?? 0);
      if (t.customer_id && amount > 0) {
        events.push({
          type: "payment",
          paymentId: inv.id ?? t.id,
          chargeIds: [t.id],
          customerId: t.customer_id,
          email: c.customer?.email ?? null,
          subscriptionId: t.subscription_id ?? null,
          amount,
          currency: String(t.currency_code ?? "usd").toLowerCase(),
          interval: c.subscription?.billing_period_unit ?? null,
          intervalCount: Number(c.subscription?.billing_period ?? 1),
          paidAt: toDate(t.date),
          attribution: {
            metadata: md,
            // the code the customer typed is coupon_set_code; entity_id is the coupon's own id
            promoCode: inv.discounts?.[0]?.coupon_set_code ?? inv.discounts?.[0]?.entity_id ?? null,
            email: c.customer?.email,
          },
          description: "Chargebee payment",
          // Chargebee's price is an item price; the item (product) id isn't on the payment
          priceId:
            inv.line_items?.find?.((l: Json) => l.entity_type === "plan_item_price")?.entity_id ??
            c.subscription?.subscription_items?.[0]?.item_price_id ??
            null,
        });
      }
      break;
    }
    case "payment_refunded": {
      const t = c.transaction ?? {};
      // a refund names the payment it refunds in refunded_txn_id; reference_transaction_id is for offline ones
      const original = t.refunded_txn_id ?? t.reference_transaction_id ?? t.linked_payments?.[0]?.txn_id;
      if (original)
        events.push({
          type: "refund",
          chargeId: original,
          refundKey: t.id,
          refunded: Number(t.amount ?? 0),
          charged: Number(c.invoice?.total ?? 0),
          incremental: true,
        });
      break;
    }
    case "chargeback_initiated":
    case "chargeback_won":
    case "chargeback_lost": {
      const chargeId = c.dispute?.transaction_id ?? c.transaction?.id;
      if (chargeId)
        events.push({
          type: "dispute",
          chargeId,
          disputeId: c.dispute?.id ?? chargeId,
          status:
            body.event_type === "chargeback_initiated"
              ? "opened"
              : body.event_type === "chargeback_won"
                ? "won"
                : "lost",
        });
      break;
    }
    case "subscription_created":
    case "subscription_changed":
    case "subscription_cancelled":
      events.push({
        type: "subscription",
        subscriptionId: c.subscription.id,
        customerId: c.subscription.customer_id,
        status:
          c.subscription.status === "cancelled"
            ? "canceled"
            : c.subscription.status === "in_trial"
              ? "trialing"
              : c.subscription.status === "active"
                ? "active"
                : "other",
        mrr: Number(c.subscription.mrr ?? 0),
        currency: c.subscription.currency_code ? String(c.subscription.currency_code).toLowerCase() : null,
        canceledAt: c.subscription.cancelled_at ? toDate(c.subscription.cancelled_at) : null,
      });
      break;
  }
  return { eventId: body.id, eventType: body.event_type, livemode, events };
}
