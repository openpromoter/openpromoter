import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto";
import {
  assertFresh,
  type BillingEvent,
  type Json,
  type ParsedWebhook,
  strRecord,
  toDate,
  WebhookSignatureError,
} from "./types";

/**
 * Polar uses Standard Webhooks: webhook-signature "v1,<base64 HMAC-SHA256(key, `${id}.${ts}.${body}`)>".
 * Secrets made before 8 Sep 2026 key the HMAC with the UTF-8 bytes of the whole `whsec_…` string; newer
 * ones are Standard Webhooks secrets, keyed with the base64-decoded part after `whsec_`. Like Polar's SDK,
 * we try both keys.
 */
export function verifyPolar(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now = Date.now(),
): Json {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) throw new WebhookSignatureError("Missing webhook-* headers");
  assertFresh(timestamp, now);
  const keys = [Buffer.from(secret, "utf8")];
  if (secret.startsWith("whsec_")) keys.push(Buffer.from(secret.slice(6), "base64"));
  const expected = keys.map((k) =>
    createHmac("sha256", k).update(`${id}.${timestamp}.${rawBody}`).digest("base64"),
  );
  const ok = signature.split(" ").some((s) => {
    const [, sig] = s.split(",");
    return !!sig && expected.some((e) => safeEqual(sig, e));
  });
  if (!ok) throw new WebhookSignatureError("Invalid Polar signature");
  return { ...JSON.parse(rawBody), __id: id };
}

/** Polar payloads carry no sandbox flag, so `livemode` comes from the connection's Sandbox setting. */
export function normalizePolar(body: Json, livemode = true): ParsedWebhook {
  const d = body.data ?? {};
  const events: BillingEvent[] = [];
  const md = strRecord(d.metadata);
  switch (body.type) {
    case "customer.created":
      events.push({
        type: "customer",
        customerId: d.id,
        email: d.email ?? null,
        name: d.name ?? null,
        attribution: { metadata: md, email: d.email },
        createdAt: toDate(d.created_at),
      });
      break;
    case "order.paid": {
      const amount = Number(d.net_amount ?? Number(d.subtotal_amount ?? 0) - Number(d.discount_amount ?? 0));
      if (d.customer_id && amount > 0) {
        events.push({
          type: "payment",
          paymentId: d.id,
          chargeIds: [d.id],
          customerId: d.customer_id,
          email: d.customer?.email ?? null,
          subscriptionId: d.subscription_id ?? null,
          amount,
          currency: String(d.currency ?? "usd").toLowerCase(),
          interval: d.product?.recurring_interval ?? d.subscription?.recurring_interval ?? null,
          intervalCount: 1,
          paidAt: toDate(d.created_at),
          attribution: {
            metadata: { ...strRecord(d.customer?.metadata), ...md },
            promoCode: d.discount?.code ?? null,
            email: d.customer?.email,
          },
          description: d.product?.name ?? "Polar order",
          priceId: d.product_price_id ?? d.items?.[0]?.product_price_id ?? null,
          productId: d.product_id ?? d.product?.id ?? null,
        });
      }
      break;
    }
    case "order.refunded":
      events.push({
        type: "refund",
        chargeId: d.id,
        refundKey: `${d.id}:${d.refunded_amount}`,
        refunded: Number(d.refunded_amount ?? 0),
        charged: Number(d.net_amount ?? d.total_amount ?? 0),
      });
      break;
    case "subscription.created":
    case "subscription.updated":
    case "subscription.canceled":
    case "subscription.revoked":
      events.push({
        type: "subscription",
        subscriptionId: d.id,
        customerId: d.customer_id,
        status:
          body.type === "subscription.revoked" || d.status === "canceled"
            ? "canceled"
            : d.status === "trialing"
              ? "trialing"
              : d.status === "active"
                ? "active"
                : d.status === "past_due"
                  ? "past_due"
                  : "other",
        mrr: 0,
        canceledAt: d.canceled_at
          ? toDate(d.canceled_at)
          : body.type === "subscription.revoked"
            ? new Date()
            : null,
      });
      break;
  }
  return {
    eventId: body.__id ?? `${body.type}:${d.id}:${d.modified_at ?? ""}`,
    eventType: body.type,
    livemode,
    events,
  };
}
