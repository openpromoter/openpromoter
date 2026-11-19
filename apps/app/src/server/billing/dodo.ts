import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto";
import { toMrr } from "@/server/commission";
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
 * Dodo Payments uses Standard Webhooks: webhook-signature "v1,<base64 HMAC-SHA256(key, `${id}.${ts}.${body}`)>",
 * keyed with the base64-decoded part of the `whsec_…` secret. A secret pasted without the prefix is
 * tried both decoded and as raw bytes.
 */
export function verifyDodo(
  rawBody: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  now = Date.now(),
): Json {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) throw new WebhookSignatureError("Missing webhook-* headers");
  assertFresh(timestamp, now);
  const bare = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keys = [Buffer.from(bare, "base64")];
  if (!secret.startsWith("whsec_")) keys.push(Buffer.from(secret, "utf8"));
  const expected = keys
    .filter((k) => k.length > 0)
    .map((k) => createHmac("sha256", k).update(`${id}.${timestamp}.${rawBody}`).digest("base64"));
  const ok = signature.split(" ").some((s) => {
    const [, sig] = s.split(",");
    return !!sig && expected.some((e) => safeEqual(sig, e));
  });
  if (!ok) throw new WebhookSignatureError("Invalid Dodo Payments signature");
  return { ...JSON.parse(rawBody), __id: id };
}

/** Dodo's Day/Week/Month/Year, lower-cased the way commissions and campaigns compare intervals. */
const interval = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  return ["day", "week", "month", "year"].includes(s) ? s : null;
};

const SUB_STATUS: Record<string, "trialing" | "active" | "canceled" | "past_due" | "other"> = {
  active: "active",
  past_due: "past_due",
  on_hold: "past_due",
  cancelled: "canceled",
  expired: "canceled",
  // the first charge never went through, so the subscription never started
  failed: "canceled",
};

const DISPUTE_STATUS: Record<string, "opened" | "won" | "lost"> = {
  dispute_opened: "opened",
  dispute_challenged: "opened",
  dispute_won: "won",
  dispute_cancelled: "won",
  dispute_expired: "won",
  dispute_lost: "lost",
  dispute_accepted: "lost",
};

/**
 * Dodo payloads carry no test flag, so `livemode` comes from the connection's Sandbox setting (test
 * mode keeps its own webhooks and secret). Amounts are minor units; a payment's `total_amount`
 * includes tax, which commissions leave out.
 */
export function normalizeDodo(body: Json, livemode = true): ParsedWebhook {
  const d = body.data ?? {};
  const events: BillingEvent[] = [];
  const md = strRecord(d.metadata);
  const customer = d.customer ?? {};
  switch (body.type) {
    case "payment.succeeded": {
      const amount = Number(d.total_amount ?? 0) - Number(d.tax ?? 0);
      const settled = Number(d.settlement_amount ?? 0) - Number(d.settlement_tax ?? 0);
      const settlementCurrency = typeof d.settlement_currency === "string" ? d.settlement_currency : null;
      // multi-subscription checkouts leave subscription_id null and list them in subscription_ids
      const subscriptionId = d.subscription_id ?? d.subscription_ids?.[0] ?? null;
      if (customer.customer_id && amount > 0) {
        events.push({
          type: "payment",
          paymentId: d.payment_id,
          chargeIds: [d.payment_id],
          customerId: customer.customer_id,
          email: customer.email ?? null,
          subscriptionId,
          amount,
          currency: String(d.currency ?? "usd").toLowerCase(),
          base:
            settlementCurrency && settled > 0
              ? { currency: settlementCurrency.toLowerCase(), amount: settled }
              : null,
          // payments don't say how often they recur; the subscription events carry the MRR
          interval: null,
          intervalCount: 1,
          paidAt: toDate(d.created_at),
          attribution: {
            metadata: { ...strRecord(customer.metadata), ...md },
            promoCode: d.discounts?.find((x: Json) => x?.code)?.code ?? null,
            email: customer.email ?? null,
          },
          description: subscriptionId ? "Dodo Payments subscription" : "Dodo Payments payment",
          productId: d.product_cart?.[0]?.product_id ?? null,
        });
      }
      break;
    }
    case "refund.succeeded":
      if (!d.payment_id || !d.refund_id) break;
      if (d.is_partial === false)
        // a full refund reverses the whole sale whatever the tax: 1 of 1
        events.push({
          type: "refund",
          chargeId: d.payment_id,
          refundKey: `${d.payment_id}:${d.refund_id}`,
          refunded: 1,
          charged: 1,
        });
      else if (Number(d.amount) > 0)
        events.push({
          type: "refund",
          chargeId: d.payment_id,
          refundKey: `${d.payment_id}:${d.refund_id}`,
          // includes tax; set against the booked pre-tax sale, so a taxed partial refund reverses a little more
          refunded: Number(d.amount),
          charged: 0,
          incremental: true,
        });
      break;
    case "dispute.opened":
    case "dispute.challenged":
    case "dispute.won":
    case "dispute.lost":
    case "dispute.accepted":
    case "dispute.cancelled":
    case "dispute.expired": {
      const status = DISPUTE_STATUS[d.dispute_status ?? `dispute_${body.type.slice(8)}`];
      if (d.payment_id && d.dispute_id && status)
        events.push({ type: "dispute", chargeId: d.payment_id, disputeId: d.dispute_id, status });
      break;
    }
    case "subscription.active":
    case "subscription.renewed":
    case "subscription.updated":
    case "subscription.plan_changed":
    case "subscription.past_due":
    case "subscription.paused":
    case "subscription.unpaused":
    case "subscription.on_hold":
    case "subscription.failed":
    case "subscription.cancelled":
    case "subscription.expired": {
      if (!d.subscription_id || !customer.customer_id) break;
      const status = SUB_STATUS[d.status] ?? "other";
      const every = interval(d.payment_frequency_interval);
      events.push({
        type: "subscription",
        subscriptionId: d.subscription_id,
        customerId: customer.customer_id,
        status,
        mrr:
          status === "active" || status === "past_due"
            ? toMrr(
                Number(d.recurring_pre_tax_amount ?? 0),
                every,
                Number(d.payment_frequency_count ?? 1) || 1,
              )
            : 0,
        currency: typeof d.currency === "string" ? d.currency.toLowerCase() : null,
        canceledAt:
          status === "canceled" ? (d.cancelled_at ? toDate(d.cancelled_at) : toDate(body.timestamp)) : null,
      });
      break;
    }
  }
  return {
    eventId: body.__id ?? `${body.type}:${d.payment_id ?? d.subscription_id ?? d.refund_id ?? d.dispute_id}`,
    eventType: body.type,
    livemode,
    events,
  };
}
