import Stripe from "stripe";
import { toMrr } from "../commission";
import {
  type BillingEvent,
  type Json,
  type ParsedWebhook,
  strRecord,
  toDate,
  WebhookSignatureError,
} from "./types";

export function stripeClient(secret: string) {
  return new Stripe(secret, {
    maxNetworkRetries: 2,
    appInfo: { name: "OpenPromoter", url: "https://openpromoter.com" },
  });
}

/** Verifies the Stripe-Signature header (HMAC-SHA256, 5 minute tolerance) and parses the event. */
export async function verifyStripe(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<Stripe.Event> {
  if (!signature) throw new WebhookSignatureError("Missing Stripe-Signature header");
  try {
    return await Stripe.webhooks.constructEventAsync(rawBody, signature, secret, 300);
  } catch (err) {
    throw new WebhookSignatureError((err as Error).message);
  }
}

const id = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String((v as Json).id) : null;

/** Interval from a line's billing period: about 30 days is a month, 365 a year, 7 a week. */
function intervalOf(period?: { start?: number; end?: number } | null) {
  if (!period?.start || !period.end) return null;
  const days = (period.end - period.start) / 86_400;
  if (days >= 27) {
    const months = Math.round(days / 30.44);
    return months % 12 === 0
      ? { interval: "year", interval_count: months / 12 }
      : { interval: "month", interval_count: Math.max(1, months) };
  }
  if (days >= 6) return { interval: "week", interval_count: Math.round(days / 7) };
  if (days >= 0.9) return { interval: "day", interval_count: Math.round(days) };
  return null;
}

/** Works with both pre-2025 and current invoice shapes (subscription and charge moved in 2025-03). */
export function invoiceFields(inv: Json) {
  const lines: Json[] = inv.lines?.data ?? [];
  // the subscription's own line, not a proration line
  const line =
    lines.find((l) => !l.proration && !l.parent?.subscription_item_details?.proration) ?? lines[0] ?? {};
  // since API 2025-03 a line carries no price object; the billing period gives the interval instead
  const recurring = line.price?.recurring ?? line.plan ?? intervalOf(line.period);
  const subscription =
    id(inv.subscription) ??
    id(inv.parent?.subscription_details?.subscription) ??
    id(line.subscription) ??
    null;
  const tax =
    typeof inv.tax === "number"
      ? inv.tax
      : Array.isArray(inv.total_taxes)
        ? inv.total_taxes.reduce((a: number, t: Json) => a + (t.amount ?? 0), 0)
        : 0;
  const chargeIds = [
    id(inv.charge),
    id(inv.payment_intent),
    ...(inv.payments?.data ?? []).flatMap((p: Json) => [
      id(p.payment?.charge),
      id(p.payment?.payment_intent),
    ]),
  ].filter((x): x is string => !!x);
  const promo =
    inv.discount?.promotion_code ??
    inv.discounts?.find?.((d: Json) => typeof d === "object" && d.promotion_code)?.promotion_code ??
    null;
  return {
    subscription,
    amount: Math.max(0, (inv.amount_paid ?? 0) - tax),
    interval: recurring?.interval ?? null,
    intervalCount: recurring?.interval_count ?? 1,
    chargeIds,
    promoCodeId: id(promo),
    metadata: {
      ...strRecord(inv.parent?.subscription_details?.metadata),
      ...strRecord(inv.subscription_details?.metadata),
      ...strRecord(inv.metadata),
    },
    description: line.description ?? inv.description ?? "Payment",
    // since API 2025-03 the ids sit under pricing.price_details; before that on price (or plan)
    priceId: id(line.pricing?.price_details?.price) ?? id(line.price) ?? id(line.plan),
    productId: id(line.pricing?.price_details?.product) ?? id(line.price?.product) ?? id(line.plan?.product),
  };
}

export type StripeLookup = {
  promoCode?: (promotionCodeId: string) => Promise<string | null>;
  invoiceCharges?: (invoiceId: string) => Promise<string[]>;
  /** Webhook invoices list discounts as bare ids since API 2025-03; this expands them to a promotion code id. */
  invoicePromo?: (invoiceId: string) => Promise<string | null>;
};

/** A paid one-time Checkout payment, which has no invoice unless invoice creation is on. */
function checkoutPayment(o: Json): BillingEvent | null {
  if (o.mode !== "payment" || o.payment_status !== "paid" || o.invoice) return null;
  const amount = Math.max(0, (o.amount_total ?? 0) - (o.total_details?.amount_tax ?? 0));
  if (amount <= 0) return null;
  return {
    type: "payment",
    paymentId: o.id,
    chargeIds: [id(o.payment_intent)].filter((x): x is string => !!x),
    customerId: id(o.customer) ?? `guest:${o.id}`,
    email: o.customer_details?.email ?? o.customer_email ?? null,
    subscriptionId: null,
    amount,
    currency: o.currency,
    interval: null,
    intervalCount: 1,
    paidAt: toDate(o.created),
    attribution: {
      clientReferenceId: o.client_reference_id,
      metadata: strRecord(o.metadata),
      email: o.customer_details?.email,
    },
    description: "One-time payment",
  };
}

export async function normalizeStripe(evt: Stripe.Event, lookup: StripeLookup = {}): Promise<ParsedWebhook> {
  const o = evt.data.object as Json;
  const events: BillingEvent[] = [];
  switch (evt.type) {
    case "customer.created":
      events.push({
        type: "customer",
        customerId: o.id,
        email: o.email ?? null,
        name: o.name ?? null,
        attribution: { metadata: strRecord(o.metadata), email: o.email },
        createdAt: toDate(o.created),
      });
      break;
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const promoId = o.discounts?.[0]?.promotion_code ?? null;
      const code =
        promoId && lookup.promoCode ? ((await lookup.promoCode(id(promoId)!)) ?? id(promoId)) : id(promoId);
      const pay = checkoutPayment(o);
      if (pay?.type === "payment") pay.attribution.promoCode = code;
      events.push({
        type: "checkout",
        customerId: id(o.customer) ?? (pay ? `guest:${o.id}` : null),
        email: o.customer_details?.email ?? o.customer_email ?? null,
        name: o.customer_details?.name ?? null,
        subscriptionId: id(o.subscription),
        attribution: {
          clientReferenceId: o.client_reference_id,
          metadata: strRecord(o.metadata),
          promoCode: code,
          email: o.customer_details?.email,
        },
      });
      if (pay) events.push(pay);
      break;
    }
    case "invoice.paid": {
      const f = invoiceFields(o);
      if (f.chargeIds.length === 0 && lookup.invoiceCharges)
        f.chargeIds.push(...(await lookup.invoiceCharges(o.id)));
      if (!f.promoCodeId && o.discounts?.length && lookup.invoicePromo)
        f.promoCodeId = await lookup.invoicePromo(o.id);
      const code =
        f.promoCodeId && lookup.promoCode
          ? ((await lookup.promoCode(f.promoCodeId)) ?? f.promoCodeId)
          : f.promoCodeId;
      if (o.customer && f.amount > 0) {
        events.push({
          type: "payment",
          paymentId: o.id,
          chargeIds: f.chargeIds,
          customerId: id(o.customer)!,
          email: o.customer_email ?? null,
          subscriptionId: f.subscription,
          amount: f.amount,
          currency: o.currency,
          interval: f.interval,
          intervalCount: f.intervalCount,
          paidAt: toDate(o.status_transitions?.paid_at ?? o.created),
          attribution: { metadata: f.metadata, promoCode: code, email: o.customer_email },
          description: f.description,
          priceId: f.priceId,
          productId: f.productId,
        });
      }
      break;
    }
    // Since API 2025-03 an invoice no longer names its charge. This event does, with or without an API key.
    case "invoice_payment.paid": {
      const paymentId = id(o.invoice);
      const chargeIds = [id(o.payment?.charge), id(o.payment?.payment_intent)].filter(
        (x): x is string => !!x,
      );
      if (paymentId && chargeIds.length) events.push({ type: "charge_link", paymentId, chargeIds });
      break;
    }
    case "charge.refunded":
      for (const chargeId of [o.id, id(o.payment_intent)].filter(Boolean) as string[]) {
        events.push({
          type: "refund",
          chargeId,
          refundKey: `${o.id}:${o.amount_refunded}`,
          refunded: o.amount_refunded ?? 0,
          charged: o.amount ?? 0,
        });
      }
      break;
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      // closed: only "lost" takes money back; won, warning_closed (an inquiry) and prevented release the hold
      const status = evt.type === "charge.dispute.created" ? "opened" : o.status === "lost" ? "lost" : "won";
      for (const chargeId of [id(o.charge), id(o.payment_intent)].filter(Boolean) as string[]) {
        events.push({ type: "dispute", chargeId, disputeId: o.id, status });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const item = o.items?.data?.[0] ?? {};
      const price = item.price ?? item.plan ?? {};
      const amount = (price.unit_amount ?? price.amount ?? 0) * (item.quantity ?? 1);
      const st = evt.type === "customer.subscription.deleted" ? "canceled" : o.status;
      events.push({
        type: "subscription",
        subscriptionId: o.id,
        customerId: id(o.customer)!,
        status: ["trialing", "active", "canceled", "past_due"].includes(st) ? st : "other",
        mrr:
          st === "canceled"
            ? 0
            : toMrr(
                amount,
                price.recurring?.interval ?? price.interval ?? null,
                price.recurring?.interval_count ?? price.interval_count ?? 1,
              ),
        currency: String(o.currency ?? price.currency ?? "").toLowerCase() || null,
        canceledAt: o.canceled_at ? toDate(o.canceled_at) : st === "canceled" ? new Date() : null,
      });
      break;
    }
  }
  return { eventId: evt.id, eventType: evt.type, livemode: evt.livemode, events };
}

/** Webhook events OpenPromoter subscribes to. */
export const STRIPE_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "customer.created",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "invoice_payment.paid",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];
