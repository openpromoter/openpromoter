import { z } from "zod";
import { formatMoney } from "@/lib/money";
import { aiJson } from "./provider";

export interface PriceFact {
  productName: string;
  unitAmount: number | null;
  currency: string;
  interval: string | null;
}

export interface DesignInput {
  programName: string;
  description?: string | null;
  prices: PriceFact[];
  /** gross margin 0-1 if the founder told us */
  margin?: number | null;
  /** Workspace whose AI allowance pays for the call. */
  workspaceId?: string;
}

export interface ProgramDesign {
  commissionType: "percent" | "fixed";
  commissionValue: number;
  commissionDuration: "once" | "months" | "lifetime";
  commissionMonths: number;
  cookieDays: number;
  holdDays: number;
  minPayout: number;
  doubleSided: { enabled: boolean; percentOff: number; durationMonths: number };
  tiers: { name: string; bonusBps: number; promoteAtRevenue: number | null }[];
  rationale: {
    commission: string;
    duration: string;
    cookie: string;
    doubleSided: string;
    tiers: string;
    payouts: string;
  };
}

/** Monthly price in minor units for the cheapest paid recurring plan, or the median one-off price. */
export function summarizePricing(prices: PriceFact[]) {
  const paid = prices.filter((p) => (p.unitAmount ?? 0) > 0);
  const monthly = paid
    .filter((p) => p.interval)
    .map((p) =>
      p.interval === "year"
        ? (p.unitAmount ?? 0) / 12
        : p.interval === "week"
          ? (p.unitAmount ?? 0) * 4.33
          : (p.unitAmount ?? 0),
    )
    .sort((a, b) => a - b);
  const oneOff = paid
    .filter((p) => !p.interval)
    .map((p) => p.unitAmount ?? 0)
    .sort((a, b) => a - b);
  const median = (xs: number[]) => (xs.length ? xs[Math.floor(xs.length / 2)]! : 0);
  return {
    recurring: monthly.length > 0,
    hasAnnual: paid.some((p) => p.interval === "year"),
    medianMonthly: Math.round(median(monthly)),
    medianOneOff: Math.round(median(oneOff)),
    currency: paid[0]?.currency ?? "usd",
  };
}

/** Deterministic design, used as-is without AI and as the anchor the AI may refine. */
export function heuristicDesign(input: DesignInput): ProgramDesign {
  const s = summarizePricing(input.prices);
  const money = (n: number) => formatMoney(n, s.currency);
  const margin = input.margin ?? 0.8;

  let rate = 30;
  let duration: ProgramDesign["commissionDuration"] = "months";
  let months = 12;
  if (!s.recurring) {
    rate = s.medianOneOff >= 50_000 ? 20 : 35;
    duration = "once";
    months = 0;
  } else if (s.medianMonthly >= 50_000) {
    rate = 20;
  } else if (s.medianMonthly > 0 && s.medianMonthly < 1500) {
    rate = 40;
    duration = "lifetime";
  }
  if (margin < 0.5) rate = Math.max(10, Math.round(rate * 0.6));

  const highTicket = s.medianMonthly >= 20_000 || s.medianOneOff >= 50_000 || s.hasAnnual;
  const cookieDays = highTicket ? 90 : 60;
  const doubleSided = s.recurring && s.medianMonthly >= 1500;
  const perSale = s.recurring
    ? Math.round((s.medianMonthly * rate) / 100)
    : Math.round((s.medianOneOff * rate) / 100);

  const commission = s.recurring
    ? `${rate}% of every payment. On your typical plan (${money(s.medianMonthly)}/month) a partner earns about ${money(perSale)} a month per customer. ${rate >= 30 ? "30% is the most common rate for SaaS programs and is high enough that creators take it seriously." : "A lower rate fits a high price: the absolute amount per customer is still large."}`
    : `${rate}% of each sale. That is about ${money(perSale)} on your typical ${money(s.medianOneOff)} purchase. One-off products need a higher rate than subscriptions because there is no recurring tail.`;
  const durationText =
    duration === "lifetime"
      ? "For as long as the customer pays. With a low price, a lifetime share is what makes it worth a partner's effort. Your cost stays a fixed slice of revenue."
      : duration === "months"
        ? `For the first ${months} months of each customer. Partners get a real recurring income while your long-term margin stays yours. Because most customers who churn leave in the first year, this also pays partners for the customers who stay.`
        : "Once, on the first purchase.";

  return {
    commissionType: "percent",
    commissionValue: rate * 100,
    commissionDuration: duration,
    commissionMonths: months,
    cookieDays,
    holdDays: s.hasAnnual ? 30 : 30,
    minPayout: s.currency === "usd" || s.currency === "eur" || s.currency === "gbp" ? 5000 : 5000,
    doubleSided: {
      enabled: doubleSided,
      percentOff: doubleSided ? 20 : 0,
      durationMonths: doubleSided ? 3 : 0,
    },
    tiers: [
      { name: "Partner", bonusBps: 0, promoteAtRevenue: null },
      { name: "Pro", bonusBps: 500, promoteAtRevenue: 500_000 },
      { name: "Elite", bonusBps: 1000, promoteAtRevenue: 2_500_000 },
    ],
    rationale: {
      commission,
      duration: durationText,
      cookie: `${cookieDays} days. ${highTicket ? "Buyers of higher-priced or annual plans compare options for weeks. A longer window keeps credit with the partner who found them." : "Long enough to cover a trial and a few return visits. Short enough that old clicks don't steal credit."}`,
      doubleSided: doubleSided
        ? "Give referred customers 20% off for 3 months. A discount in the partner's link converts better than a plain link and makes partners more willing to share it."
        : "Off for now. On a low (or one-off) price, a discount would cost more margin than it adds in conversions. You can turn it on later.",
      tiers: `There are three tiers and everyone starts at ${rate}%. Partners move up automatically: +5 points after ${money(500_000)} in referred revenue and +10 points after ${money(2_500_000)}. Your best partners earn more without you having to negotiate.`,
      payouts:
        "Pay monthly once a partner is owed at least $50 and the 30-day hold has passed. The hold covers most refunds. You rarely pay a commission you would have to claw back.",
    },
  };
}

const schema = z.object({
  commissionValuePercent: z.number().min(5).max(60),
  commissionDuration: z.enum(["once", "months", "lifetime"]),
  commissionMonths: z.number().int().min(0).max(36),
  cookieDays: z.number().int().min(7).max(180),
  doubleSidedPercentOff: z.number().min(0).max(50),
  rationale: z.object({
    commission: z.string(),
    duration: z.string(),
    cookie: z.string(),
    doubleSided: z.string(),
    tiers: z.string(),
    payouts: z.string(),
  }),
});

/** AI refines the heuristic design. Stays inside sane bounds; falls back to the heuristic. */
export async function designProgram(
  input: DesignInput,
): Promise<ProgramDesign & { source: "ai" | "heuristic" }> {
  const base = heuristicDesign(input);
  const s = summarizePricing(input.prices);
  const ai = await aiJson(schema, {
    system:
      "You design affiliate programs for SaaS companies. Be concrete and plain. Each rationale is one short paragraph (2-3 sentences) addressed to the founder, explaining the choice with numbers from their pricing. No hype.",
    prompt: `Company: ${input.programName}\nAbout: ${input.description ?? "unknown"}\nPrices: ${JSON.stringify(input.prices.slice(0, 20))}\nSummary: ${JSON.stringify(s)}\nGross margin: ${input.margin ?? "unknown (assume ~80% for SaaS)"}\nBaseline proposal: ${JSON.stringify({ ...base, rationale: undefined })}\nTier rules: tiers add +5 and +10 percentage points at ${base.tiers[1]?.promoteAtRevenue} and ${base.tiers[2]?.promoteAtRevenue} minor units of referred revenue. Payouts monthly, $50 minimum, 30 day hold.\nReturn your recommended design. Only deviate from the baseline with a clear reason.`,
    effort: "low",
    // measured 2026-11-06 on hard cases: Sonnet made the same choices as Opus for half the cost.
    // Haiku cut a low-margin program to 10% and kept a 20% customer discount.
    tier: "smart",
    workspaceId: input.workspaceId,
  });
  if (!ai) return { ...base, source: "heuristic" };
  return {
    ...base,
    commissionValue: Math.round(ai.commissionValuePercent * 100),
    commissionDuration: ai.commissionDuration,
    commissionMonths: ai.commissionDuration === "months" ? Math.max(1, ai.commissionMonths) : 0,
    cookieDays: ai.cookieDays,
    doubleSided: {
      enabled: ai.doubleSidedPercentOff > 0,
      percentOff: ai.doubleSidedPercentOff,
      durationMonths: ai.doubleSidedPercentOff > 0 ? 3 : 0,
    },
    rationale: ai.rationale,
    source: "ai",
  };
}
