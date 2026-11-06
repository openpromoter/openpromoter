import { describe, expect, it } from "vitest";
import {
  addMonths,
  bestBoost,
  type CampaignLike,
  computeCommission,
  refundShare,
  resolvePlan,
  toMrr,
} from "@/server/commission";

const pct = { type: "percent" as const, value: 3000, duration: "months" as const, months: 12 };
const pay = (o: Partial<Parameters<typeof computeCommission>[1]> = {}) => ({
  amount: 10000,
  currency: "usd",
  paidAt: new Date("2026-03-01"),
  interval: "month",
  firstPaidAt: null,
  priorPayments: 0,
  ...o,
});

describe("commission maths", () => {
  it("percent of the payment, rounded to minor units", () => {
    expect(computeCommission(pct, pay({ amount: 4999 })).amount).toBe(1500);
    expect(computeCommission(pct, pay()).amount).toBe(3000);
  });
  it("fixed amount per payment", () => {
    expect(computeCommission({ ...pct, type: "fixed", value: 2500 }, pay()).amount).toBe(2500);
  });
  it("one-time only pays the first payment", () => {
    const once = { ...pct, duration: "once" as const };
    expect(computeCommission(once, pay()).eligible).toBe(true);
    expect(
      computeCommission(once, pay({ priorPayments: 1, firstPaidAt: new Date("2026-02-01") })).eligible,
    ).toBe(false);
  });
  it("recurring N months stops at the window end", () => {
    const first = new Date("2025-03-01");
    expect(
      computeCommission(pct, pay({ firstPaidAt: first, priorPayments: 11, paidAt: new Date("2026-02-28") }))
        .eligible,
    ).toBe(true);
    expect(
      computeCommission(pct, pay({ firstPaidAt: first, priorPayments: 12, paidAt: new Date("2026-03-01") }))
        .eligible,
    ).toBe(false);
  });
  it("lifetime never stops", () => {
    expect(
      computeCommission(
        { ...pct, duration: "lifetime" },
        pay({ firstPaidAt: new Date("2020-01-01"), priorPayments: 70 }),
      ).eligible,
    ).toBe(true);
  });
  it("nothing paid earns nothing", () => {
    expect(computeCommission(pct, pay({ amount: 0 })).eligible).toBe(false);
  });
  it("tier override wins over program default", () => {
    const plan = resolvePlan(
      {
        commissionType: "percent",
        commissionValue: 3000,
        commissionDuration: "lifetime",
        commissionMonths: 0,
      },
      { commissionType: "percent", commissionValue: 4000 },
    );
    expect(plan.value).toBe(4000);
    expect(
      resolvePlan(
        {
          commissionType: "percent",
          commissionValue: 3000,
          commissionDuration: "lifetime",
          commissionMonths: 0,
        },
        { commissionType: null, commissionValue: null },
      ).value,
    ).toBe(3000);
  });
});

describe("campaign boosts", () => {
  const c = (o: Partial<CampaignLike>): CampaignLike => ({
    id: "c",
    rule: { kind: "boost", multiplier: 2 },
    startsAt: new Date("2026-03-01"),
    endsAt: new Date("2026-04-01"),
    status: "active",
    ...o,
  });
  it("applies the strongest live boost, never compounds", () => {
    const r = computeCommission(pct, pay({ paidAt: new Date("2026-03-10") }), [
      c({ id: "a" }),
      c({ id: "b", rule: { kind: "boost", multiplier: 3 } }),
    ]);
    expect(r.amount).toBe(9000);
    expect(r.campaignId).toBe("b");
  });
  it("respects interval filters and dates", () => {
    const annual = c({ rule: { kind: "boost", multiplier: 2, intervals: ["year"] } });
    expect(bestBoost([annual], new Date("2026-03-10"), "month", null)).toBeNull();
    expect(bestBoost([annual], new Date("2026-03-10"), "year", null)?.multiplier).toBe(2);
    expect(bestBoost([c({})], new Date("2026-04-02"), "month", null)).toBeNull();
    expect(bestBoost([c({ status: "draft" })], new Date("2026-03-10"), "month", null)).toBeNull();
  });
  it("respects group filters", () => {
    const g = c({ rule: { kind: "boost", multiplier: 2, groupIds: ["grp_1"] } });
    expect(bestBoost([g], new Date("2026-03-10"), null, "grp_2")).toBeNull();
    expect(bestBoost([g], new Date("2026-03-10"), null, "grp_1")?.multiplier).toBe(2);
  });
});

describe("refunds and helpers", () => {
  it("claws back proportionally", () => {
    expect(refundShare(3000, 10000, 5000)).toBe(1500);
    expect(refundShare(3000, 10000, 10000)).toBe(3000);
    expect(refundShare(3000, 10000, 20000)).toBe(3000);
    expect(refundShare(3000, 0, 100)).toBe(0);
  });
  it("monthly recurring revenue", () => {
    expect(toMrr(12000, "year")).toBe(1000);
    expect(toMrr(1000, "month")).toBe(1000);
    expect(toMrr(1000, "month", 3)).toBe(333);
    expect(toMrr(1000, null)).toBe(0);
  });
  it("adds months clamping to month end", () => {
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});
