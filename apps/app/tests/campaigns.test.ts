import { describe, expect, it } from "vitest";
import { routeQuestion } from "@/server/ai/assistant";
import { parseSite, pickBrandColor, readableOnWhite } from "@/server/ai/brand";
import { bannerSvg, templateKit } from "@/server/ai/content";
import { heuristicDesign } from "@/server/ai/designer";
import { parseCampaign } from "@/server/campaigns";
import { applicationRisk, autoApproveDecision } from "@/server/partners";

const now = new Date("2026-03-10T12:00:00Z");

describe("campaign builder (rule-based)", () => {
  it("double commissions for annual plans this month", () => {
    const d = parseCampaign("Double commissions for annual plans this month", now)!;
    expect(d.rule).toEqual({ kind: "boost", multiplier: 2, intervals: ["year"] });
    expect(d.endsAt?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
  it("bounties per signup and per post", () => {
    expect(parseCampaign("$5 per signup for 14 days", now)!.rule).toMatchObject({
      kind: "bounty",
      trigger: "signup",
      reward: 500,
    });
    expect(parseCampaign("Pay $50 per YouTube video review", now)!.rule).toMatchObject({
      kind: "bounty",
      trigger: "post",
      reward: 5000,
    });
    expect(parseCampaign("$100 bonus on their first sale", now)!.rule).toMatchObject({
      kind: "bounty",
      trigger: "first_sale",
      reward: 10000,
    });
  });
  it("contests with prizes", () => {
    const d = parseCampaign("Contest this month: top 3 by revenue win $500, $250, $100", now)!;
    expect(d.rule).toMatchObject({ kind: "contest", metric: "revenue", prizes: [50000, 25000, 10000] });
  });
  it("returns null when it can't understand", () => {
    expect(parseCampaign("hello there", now)).toBeNull();
  });
});

describe("AI features without AI keys", () => {
  it("designs a sensible program from pricing", () => {
    const d = heuristicDesign({
      programName: "Acme",
      prices: [
        { productName: "Pro", unitAmount: 2900, currency: "usd", interval: "month" },
        { productName: "Pro annual", unitAmount: 29000, currency: "usd", interval: "year" },
      ],
    });
    expect(d).toMatchObject({
      commissionType: "percent",
      commissionValue: 3000,
      commissionDuration: "months",
      commissionMonths: 12,
      cookieDays: 90,
    });
    expect(d.rationale.commission).toContain("30%");
    const cheap = heuristicDesign({
      programName: "X",
      prices: [{ productName: "Lite", unitAmount: 900, currency: "usd", interval: "month" }],
    });
    expect(cheap.commissionDuration).toBe("lifetime");
    const oneoff = heuristicDesign({
      programName: "X",
      prices: [{ productName: "Course", unitAmount: 19900, currency: "usd", interval: null }],
    });
    expect(oneoff.commissionDuration).toBe("once");
  });
  it("reads brand facts from a page", () => {
    const html = `<html><head><title>Acme — Ship faster</title><meta name="description" content="Acme helps teams ship &amp; grow."><meta name="theme-color" content="#7c3aed"><link rel="icon" href="/favicon.png"></head><body><h1>Ship <b>faster</b></h1></body></html>`;
    const s = parseSite("https://acme.test/", html);
    expect(s).toMatchObject({
      name: "Acme",
      description: "Acme helps teams ship & grow.",
      headline: "Ship faster",
      logoUrl: "https://acme.test/favicon.png",
      color: "#7C3AED",
    });
    expect(pickBrandColor("<style>a{color:#ff5a1f}b{color:#ff5a1f}</style>")).toBe("#FF5A1F");
    expect(readableOnWhite("#FACC15")).not.toBe("#FACC15");
  });
  it("routes questions to data tools", () => {
    expect(routeQuestion("which partners brought paying customers last month?")).toEqual({
      tool: "partners_with_customers",
      days: 30,
    });
    expect(routeQuestion("how much do we owe partners")).toMatchObject({ tool: "payouts_owed" });
    expect(routeQuestion("any suspicious activity this week?")).toEqual({ tool: "fraud", days: 7 });
  });
  it("builds a template content kit with link placeholders and banners", () => {
    const kit = templateKit(
      { name: "Acme", doubleSided: { enabled: true, percentOff: 20, durationMonths: 3 } } as never,
      { name: "Acme", description: "Acme helps teams ship.", headline: null },
    );
    expect(kit.filter((k) => k.kind !== "banner").every((k) => k.body.includes("{{link}}"))).toBe(true);
    expect(kit.filter((k) => k.kind === "banner")).toHaveLength(4);
    expect(
      bannerSvg({ width: 300, height: 250, name: "A&B", headline: "<b>", color: "#000", fg: "#fff" }),
    ).toContain("A&amp;B");
  });
  it("auto-approve rules", () => {
    const prog = {
      visibility: "public" as const,
      autoApprove: {
        enabled: true,
        maxRiskScore: 40,
        requireWebsite: true,
        blockedCountries: ["XX"],
        allowedEmailDomains: [],
      },
    };
    expect(
      autoApproveDecision(prog, {
        email: "a@b.test",
        website: "https://b.test",
        riskScore: 0,
        invited: false,
      }).approve,
    ).toBe(true);
    expect(
      autoApproveDecision(prog, { email: "a@b.test", website: null, riskScore: 0, invited: false }).approve,
    ).toBe(false);
    expect(
      autoApproveDecision(prog, {
        email: "a@b.test",
        website: "x",
        country: "xx",
        riskScore: 0,
        invited: false,
      }).approve,
    ).toBe(false);
    expect(
      autoApproveDecision(prog, { email: "a@b.test", website: null, riskScore: 0, invited: true }).approve,
    ).toBe(true);
    expect(applicationRisk({ email: "x@mailinator.com" })).toBeGreaterThan(40);
  });
});

import { mapHeaders, parseCsv } from "@/server/importer";

describe("partner import", () => {
  it("parses CSV with quotes and maps competitor headers", () => {
    const rows = parseCsv(
      'Email,First Name,Last Name,ref_id,"coupon_code"\r\n"a@b.test","Ann ""A""",Lee,ann1,ANN20\n\n',
    );
    expect(rows).toEqual([
      ["Email", "First Name", "Last Name", "ref_id", "coupon_code"],
      ["a@b.test", 'Ann "A"', "Lee", "ann1", "ANN20"],
    ]);
    expect(mapHeaders(rows[0]!)).toMatchObject({ email: 0, first: 1, last: 2, code: 3, coupon: 4 });
  });
});
