import type { CampaignRule, CommissionDuration, CommissionType, ProductRate } from "@openpromoter/db";

export interface CommissionPlan {
  type: CommissionType;
  /** basis points for percent (3000 = 30%), minor units for fixed */
  value: number;
  duration: CommissionDuration;
  months: number;
  /** "months" only: the rate paid for life once the first `months` are over. null = nothing after. */
  after?: number | null;
}

export interface CampaignLike {
  id: string;
  rule: CampaignRule;
  startsAt: Date;
  endsAt: Date | null;
  status: "draft" | "active" | "ended";
}

export interface PaymentInput {
  /** Amount actually paid, minor units, after discounts, excluding tax. */
  amount: number;
  currency: string;
  paidAt: Date;
  /** "month" | "year" | null for one-off */
  interval: string | null;
  /** When the referral first paid (null if this is the first payment). */
  firstPaidAt: Date | null;
  /** Number of paid invoices before this one. */
  priorPayments: number;
}

export interface CommissionResult {
  amount: number;
  eligible: boolean;
  reason: string;
  campaignId: string | null;
  multiplier: number;
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

/**
 * The product rate for a payment: its price id wins over its product id.
 * ponytail: one rate per payment from its main line; split by invoice line if plan + add-on invoices need it.
 */
export function productRateFor(
  rates: ProductRate[] | null | undefined,
  payment: { priceId?: string | null; productId?: string | null },
): ProductRate | null {
  if (!rates?.length) return null;
  return (
    (payment.priceId && rates.find((r) => r.id === payment.priceId)) ||
    (payment.productId && rates.find((r) => r.id === payment.productId)) ||
    null
  );
}

/**
 * Resolve the plan for a partner. Precedence, strongest first:
 * partner override > product rate > tier/group rate > program rate.
 * Duration and months always come from the program. The program's later rate (commissionAfterValue)
 * is in the program's unit, so it follows only a plan of the program's commission type.
 */
export function resolvePlan(
  program: {
    commissionType: CommissionType;
    commissionValue: number;
    commissionDuration: CommissionDuration;
    commissionMonths: number;
    commissionAfterValue?: number | null;
  },
  group?: { commissionType: CommissionType | null; commissionValue: number | null } | null,
  partnerOverride?: number | null,
  product?: Pick<ProductRate, "type" | "value"> | null,
): CommissionPlan {
  const grouped = !!group?.commissionType && group.commissionValue != null;
  // a partner override always uses the program's commission type (percent stays percent)
  const [type, value] =
    partnerOverride != null
      ? [program.commissionType, partnerOverride]
      : product
        ? [product.type, product.value]
        : grouped
          ? [group!.commissionType!, group!.commissionValue!]
          : [program.commissionType, program.commissionValue];
  return {
    type,
    value,
    duration: program.commissionDuration,
    months: program.commissionMonths,
    after: type === program.commissionType ? (program.commissionAfterValue ?? null) : null,
  };
}

export function isCampaignLive(c: CampaignLike, at: Date): boolean {
  return c.status === "active" && c.startsAt <= at && (c.endsAt == null || c.endsAt > at);
}

/** Pick the strongest live boost (boosts never compound). */
export function bestBoost(
  campaigns: CampaignLike[],
  at: Date,
  interval: string | null,
  groupId: string | null,
): { id: string; multiplier: number } | null {
  let best: { id: string; multiplier: number } | null = null;
  for (const c of campaigns) {
    if (c.rule.kind !== "boost" || !isCampaignLive(c, at)) continue;
    if (c.rule.intervals?.length && (!interval || !c.rule.intervals.includes(interval))) continue;
    if (c.rule.groupIds?.length && (!groupId || !c.rule.groupIds.includes(groupId))) continue;
    const m = c.rule.multiplier ?? 1;
    if (m > 1 && (!best || m > best.multiplier)) best = { id: c.id, multiplier: m };
  }
  return best;
}

export function computeCommission(
  plan: CommissionPlan,
  payment: PaymentInput,
  campaigns: CampaignLike[] = [],
  groupId: string | null = null,
): CommissionResult {
  const none = (reason: string): CommissionResult => ({
    amount: 0,
    eligible: false,
    reason,
    campaignId: null,
    multiplier: 1,
  });
  if (payment.amount <= 0) return none("Nothing was paid");

  if (plan.duration === "once" && payment.priorPayments > 0)
    return none("One-time commission already earned");
  let value = plan.value;
  let later = false;
  if (plan.duration === "months" && payment.firstPaidAt) {
    const end = addMonths(payment.firstPaidAt, plan.months);
    if (payment.paidAt >= end) {
      if (!plan.after || plan.after <= 0) return none(`Commission window of ${plan.months} months has ended`);
      value = plan.after;
      later = true;
    }
  }

  const base = plan.type === "percent" ? Math.round((payment.amount * value) / 10_000) : value;
  const boost = bestBoost(campaigns, payment.paidAt, payment.interval, groupId);
  const multiplier = boost?.multiplier ?? 1;
  const amount = Math.round(base * multiplier);
  const rate = `${plan.type === "percent" ? `${value / 100}% of the payment` : "fixed amount"}${later ? ` after the first ${plan.months} months` : ""}`;
  return {
    amount,
    eligible: amount > 0,
    reason: boost ? `${rate} boosted ${multiplier}x by a campaign` : rate,
    campaignId: boost?.id ?? null,
    multiplier,
  };
}

/** Two-tier override: the recruiter's share (basis points) of a sub-partner commission. */
export function overrideAmount(subCommission: number, rateBp: number): number {
  if (subCommission <= 0 || rateBp <= 0) return 0;
  return Math.round((subCommission * Math.min(rateBp, 10_000)) / 10_000);
}

/** Commission to claw back for a refund of `refunded` out of `charged`. */
export function refundShare(commissionAmount: number, charged: number, refunded: number): number {
  if (charged <= 0 || refunded <= 0) return 0;
  if (refunded >= charged) return commissionAmount;
  return Math.round((commissionAmount * refunded) / charged);
}

/** Monthly recurring revenue contribution of a subscription price, minor units. */
export function toMrr(amount: number, interval: string | null, intervalCount = 1): number {
  if (!interval) return 0;
  const perMonth = { day: 30, week: 52 / 12, month: 1, year: 1 / 12 }[interval] ?? 0;
  return Math.round((amount * perMonth) / intervalCount);
}
