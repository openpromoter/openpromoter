import type { CampaignRule } from "@openpromoter/db";
import { formatMoney } from "./money";

export function describeRule(r: CampaignRule, currency: string) {
  const m = (n?: number) => formatMoney(n ?? 0, currency);
  if (r.kind === "boost")
    return `${r.multiplier}x commissions${r.intervals?.length ? ` on ${r.intervals.includes("year") ? "annual" : "monthly"} plans` : ""}`;
  if (r.kind === "bounty")
    return {
      signup: `${m(r.reward)} per signup`,
      first_sale: `${m(r.reward)} for a partner's first paying customer`,
      revenue_milestone: `${m(r.reward)} when a partner refers ${m(r.milestone)}`,
      post: `${m(r.reward)} per approved post or video`,
    }[r.trigger ?? "first_sale"];
  return `Top ${r.prizes?.length ?? 0} by ${r.metric}: ${(r.prizes ?? []).map((p) => m(p)).join(", ")}`;
}
