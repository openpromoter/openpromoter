import { describe, expect, it } from "vitest";
import { calcSpan, paymentsInTerm, perCustomer } from "@/lib/plan-earnings";

const base = {
  commissionType: "percent" as const,
  commissionValue: 3000,
  commissionDuration: "months" as const,
  commissionMonths: 12,
};
const lifetime = { id: "a", label: "Lifetime", amount: 2999, interval: "once" as const };
const monthly = { id: "b", label: "Monthly", amount: 499, interval: "month" as const };
const yearly = { id: "c", label: "Yearly", amount: 4000, interval: "year" as const };

describe("plan earnings", () => {
  it("pays 30% once on a one-time plan", () => {
    expect(perCustomer(base, lifetime)).toEqual({ revenue: 2999, earned: 900, payments: 1 });
  });

  it("pays every monthly payment inside the term", () => {
    expect(perCustomer(base, monthly)).toEqual({ revenue: 5988, earned: 1800, payments: 12 });
  });

  it("counts yearly payments across the term", () => {
    expect(paymentsInTerm(base, "year")).toBe(1);
    expect(perCustomer({ ...base, commissionMonths: 24 }, yearly)).toEqual({
      revenue: 8000,
      earned: 2400,
      payments: 2,
    });
    expect(paymentsInTerm({ ...base, commissionMonths: 24 }, "year")).toBe(2);
    expect(paymentsInTerm({ ...base, commissionMonths: 18 }, "year")).toBe(2);
  });

  it("pays only the first payment on a first-payment program", () => {
    expect(perCustomer({ ...base, commissionDuration: "once" }, monthly)).toEqual({
      revenue: 499,
      earned: 150,
      payments: 1,
    });
  });

  it("shows the first year of a lifetime program", () => {
    expect(paymentsInTerm({ ...base, commissionDuration: "lifetime" }, "month")).toBe(12);
    expect(paymentsInTerm({ ...base, commissionDuration: "lifetime" }, "year")).toBe(1);
    expect(calcSpan({ ...base, commissionDuration: "lifetime" })).toBe("in their first year");
  });

  it("pays a fixed amount once per customer whatever the price", () => {
    const fixed = { ...base, commissionType: "fixed" as const, commissionValue: 2500 };
    expect(perCustomer(fixed, monthly)).toEqual({ revenue: 5988, earned: 2500, payments: 12 });
  });

  it("describes the span of the totals", () => {
    expect(calcSpan(base)).toBe("over their first 12 months");
    expect(calcSpan({ ...base, commissionDuration: "once" })).toBe("on their first payment");
  });
});

describe("plan price label", () => {
  it("names the billing period", async () => {
    const { planPrice } = await import("@/lib/plan-earnings");
    expect(planPrice(lifetime, "usd")).toBe("$29.99 once");
    expect(planPrice(monthly, "usd")).toBe("$4.99 a month");
    expect(planPrice(yearly, "usd")).toBe("$40.00 a year");
  });
});
