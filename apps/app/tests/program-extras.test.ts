import type { ApplicationQuestion } from "@openpromoter/db";
import { describe, expect, it, vi } from "vitest";
import { applicationAnswer, MULTI_SEP } from "@/lib/application-answer";
import { afterLabel, durationLabel } from "@/lib/program-labels";
import { computeCommission, resolvePlan } from "@/server/commission";

let host = "app.openpromoter.test";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host }) }));
const { at, programBase } = await import("@/server/program-base");
const { programUrl } = await import("@/server/ref-link");

const prog = {
  commissionType: "percent" as const,
  commissionValue: 3000,
  commissionDuration: "months" as const,
  commissionMonths: 12,
  commissionAfterValue: 1000,
  currency: "usd",
};
const first = new Date("2025-03-01");
const pay = (paidAt: string) => ({
  amount: 10000,
  currency: "usd",
  paidAt: new Date(paidAt),
  interval: "month",
  firstPaidAt: first,
  priorPayments: 5,
});

describe("a lower rate after the first months", () => {
  it("pays the full rate inside the window and the later rate for life after it", () => {
    const plan = resolvePlan(prog);
    expect(computeCommission(plan, pay("2026-02-28")).amount).toBe(3000);
    const later = computeCommission(plan, pay("2026-03-01"));
    expect(later.amount).toBe(1000);
    expect(later.reason).toContain("after the first 12 months");
    expect(computeCommission(plan, pay("2031-01-01")).amount).toBe(1000);
  });
  it("stops after the window when no later rate is set", () => {
    const plan = resolvePlan({ ...prog, commissionAfterValue: null });
    expect(computeCommission(plan, pay("2026-03-01")).eligible).toBe(false);
  });
  it("a partner override keeps the later rate; a fixed-amount tier on a percent program drops it", () => {
    expect(resolvePlan(prog, null, 5000).after).toBe(1000);
    expect(resolvePlan(prog, { commissionType: "fixed", commissionValue: 2000 }).after).toBeNull();
  });
  it("is shown to partners", () => {
    expect(afterLabel(prog)).toBe(", then 10% for life");
    expect(durationLabel(prog)).toBe("for 12 months per customer, then 10% for life");
    expect(afterLabel({ ...prog, commissionDuration: "lifetime" })).toBe("");
  });
});

describe("application questions", () => {
  const q = (type: ApplicationQuestion["type"], options?: string[]): ApplicationQuestion => ({
    id: "q1",
    label: "Q",
    type,
    required: true,
    options,
  });
  it("keeps only the founder's own choices", () => {
    expect(applicationAnswer(q("select", ["Blog", "YouTube"]), "YouTube")).toBe("YouTube");
    expect(applicationAnswer(q("select", ["Blog", "YouTube"]), "<script>")).toBe("");
    expect(
      applicationAnswer(q("multi", ["Blog", "YouTube", "X"]), ["X", "Blog", "Spam"].join(MULTI_SEP)),
    ).toBe("Blog, X");
    expect(applicationAnswer(q("checkbox"), "on")).toBe("Yes");
    expect(applicationAnswer(q("checkbox"), "")).toBe("");
    expect(applicationAnswer(q("text"), "  hi  ")).toBe("hi");
  });
});

describe("program URLs on a custom domain", () => {
  const p = { slug: "acme", customDomain: "partners.acme.com", customDomainVerifiedAt: new Date() };
  it("live at the domain's root there and under /p/slug on the app", async () => {
    host = "partners.acme.com";
    expect(await programBase(p)).toBe("");
    expect(at(await programBase(p))).toBe("/");
    host = "app.openpromoter.test";
    expect(await programBase(p)).toBe("/p/acme");
    expect(await programBase({ ...p, customDomainVerifiedAt: null })).toBe("/p/acme");
  });
  it("emails and settings link to the domain once it is verified", () => {
    expect(programUrl(p, "/apply")).toBe("https://partners.acme.com/apply");
    expect(programUrl(p)).toBe("https://partners.acme.com/");
    expect(programUrl({ ...p, customDomainVerifiedAt: null }, "/apply")).toMatch(/\/p\/acme\/apply$/);
  });
});
