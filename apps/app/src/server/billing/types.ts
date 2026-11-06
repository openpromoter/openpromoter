export type Provider = "stripe" | "paddle" | "lemonsqueezy" | "polar" | "chargebee" | "api";

export interface Attribution {
  clientReferenceId?: string | null;
  metadata?: Record<string, string> | null;
  promoCode?: string | null;
  email?: string | null;
}

/** Provider-neutral billing events. Every adapter maps its webhooks to these. */
export type BillingEvent =
  | {
      type: "customer";
      customerId: string;
      email: string | null;
      name: string | null;
      attribution: Attribution;
      createdAt: Date;
    }
  | {
      type: "checkout";
      customerId: string | null;
      email: string | null;
      name: string | null;
      subscriptionId: string | null;
      attribution: Attribution;
    }
  | {
      type: "payment";
      paymentId: string;
      chargeIds: string[];
      customerId: string;
      email: string | null;
      subscriptionId: string | null;
      /** paid amount excluding tax, minor units */
      amount: number;
      currency: string;
      interval: string | null;
      intervalCount: number;
      paidAt: Date;
      attribution: Attribution;
      description: string;
    }
  | {
      type: "refund";
      chargeId: string;
      refundKey: string;
      /** Cumulative amount refunded on the charge, unless `incremental`. */
      refunded: number;
      /** What the charge was for; 0 when the provider doesn't say (the booked sale amount is used). */
      charged: number;
      /** `refunded` is this one refund only (Paddle adjustments, Chargebee refunds), not the running total. */
      incremental?: boolean;
    }
  | { type: "dispute"; chargeId: string; disputeId: string; status: "opened" | "won" | "lost" }
  /** The charges that paid an invoice (Stripe invoice_payment.paid), for refunds and disputes. */
  | { type: "charge_link"; paymentId: string; chargeIds: string[] }
  | {
      type: "subscription";
      subscriptionId: string;
      customerId: string;
      status: "trialing" | "active" | "canceled" | "past_due" | "other";
      mrr: number;
      canceledAt: Date | null;
    };

export interface ParsedWebhook {
  eventId: string;
  eventType: string;
  livemode: boolean;
  events: BillingEvent[];
}

export class WebhookSignatureError extends Error {}

/** Replay window for signed webhooks: the signed timestamp (unix seconds) must be a number within `toleranceSec` of now. */
export function assertFresh(ts: string | number | null | undefined, now = Date.now(), toleranceSec = 300) {
  const t = typeof ts === "number" ? ts : /^\d{1,12}$/.test(String(ts ?? "")) ? Number(ts) : Number.NaN;
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec)
    throw new WebhookSignatureError("Webhook timestamp missing or outside the 5 minute tolerance");
}

export type Json = Record<string, any>;

export const toDate = (v: unknown): Date => {
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string") return new Date(v);
  return new Date();
};

export const strRecord = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object")
    for (const [k, val] of Object.entries(v)) if (val != null) out[k] = String(val);
  return out;
};
