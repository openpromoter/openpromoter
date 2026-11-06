import { describe, expect, it } from "vitest";
import {
  combineScores,
  detectSignals,
  isBotUserAgent,
  isPaidSearchClick,
  normalizeEmail,
  scorePartner,
  scoreReferral,
} from "@/server/fraud";

const ref = (o = {}) => ({
  id: "r",
  email: null,
  ipHash: null,
  via: "link",
  status: "active",
  createdAt: new Date("2026-01-01"),
  canceledAt: null,
  ...o,
});
const click = (o = {}) => ({
  visitorId: "v",
  ipHash: null,
  userAgent: "Mozilla/5.0",
  landingUrl: "https://acme.test/",
  referrer: null,
  utm: null,
  isBot: false,
  ...o,
});
const base = {
  partnerEmail: "pat@partner.test",
  partnerSignupIpHash: "ip1",
  referrals: [],
  clicks: [],
  paidCommissions: 0,
  refundedAfterPayout: 0,
};

describe("fraud scoring", () => {
  it("normalizes email aliases", () => {
    expect(normalizeEmail("Pat.Smith+aff@GMAIL.com")).toBe("patsmith@gmail.com");
    expect(normalizeEmail("pat+x@acme.test")).toBe("pat@acme.test");
  });
  it("combines scores with noisy-OR and caps at 100", () => {
    expect(combineScores([])).toBe(0);
    expect(combineScores([50, 50])).toBe(75);
    expect(combineScores([100, 10])).toBe(100);
  });
  it("detects self-referral and same network", () => {
    const s = detectSignals({
      ...base,
      referrals: [ref({ id: "a", email: "PAT+1@partner.test" }), ref({ id: "b", ipHash: "ip1" })],
    });
    expect(s.map((x) => x.kind)).toEqual(["self_referral", "same_ip_as_partner"]);
  });
  it("detects duplicate accounts on one network", () => {
    const s = detectSignals({
      ...base,
      referrals: [1, 2, 3].map((i) => ref({ id: `r${i}`, ipHash: "shared" })),
    });
    expect(s.some((x) => x.kind === "duplicate_accounts")).toBe(true);
  });
  it("detects coupon leaking", () => {
    const s = detectSignals({
      ...base,
      referrals: Array.from({ length: 6 }, (_, i) => ref({ id: `r${i}`, via: "coupon" })),
    });
    expect(s.some((x) => x.kind === "coupon_leak")).toBe(true);
  });
  it("detects brand bidding from paid search clicks", () => {
    expect(isPaidSearchClick({ landingUrl: "https://acme.test/?gclid=abc" })).toBe(true);
    expect(
      isPaidSearchClick({
        landingUrl: "https://acme.test/",
        referrer: "https://www.google.com/",
        utm: { utm_medium: "cpc" },
      }),
    ).toBe(true);
    expect(isPaidSearchClick({ landingUrl: "https://acme.test/", referrer: "https://twitter.com/" })).toBe(
      false,
    );
    const s = detectSignals({
      ...base,
      clicks: [1, 2, 3].map(() => click({ landingUrl: "https://acme.test/?gclid=1" })),
    });
    expect(s.some((x) => x.kind === "brand_bidding")).toBe(true);
  });
  it("detects click spam and bots", () => {
    expect(isBotUserAgent("Googlebot/2.1")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    const spam = detectSignals({
      ...base,
      clicks: Array.from({ length: 30 }, () => click({ ipHash: "same" })),
    });
    expect(spam.some((x) => x.kind === "click_spam")).toBe(true);
    const bots = detectSignals({
      ...base,
      clicks: Array.from({ length: 20 }, (_, i) => click({ visitorId: `v${i}`, userAgent: "curl/8" })),
    });
    expect(bots.some((x) => x.kind === "bot_traffic")).toBe(true);
  });
  it("detects refunds after payout and fast churn", () => {
    expect(
      detectSignals({ ...base, paidCommissions: 4, refundedAfterPayout: 2 }).some(
        (x) => x.kind === "refund_after_payout",
      ),
    ).toBe(true);
    const churn = Array.from({ length: 6 }, (_, i) =>
      ref({ id: `c${i}`, canceledAt: new Date("2026-01-03") }),
    );
    expect(detectSignals({ ...base, referrals: churn }).some((x) => x.kind === "fast_churn")).toBe(true);
  });
  it("clean partners score 0", () => {
    expect(scorePartner({ ...base, referrals: [ref()], clicks: [click()] }).score).toBe(0);
  });
  it("scores a single referral for auto-hold", () => {
    expect(
      scoreReferral(
        { email: "pat@x.test", signupIpHash: null, riskScore: 0 },
        { email: "pat@x.test", ipHash: null },
      ).score,
    ).toBeGreaterThanOrEqual(95);
    expect(
      scoreReferral(
        { email: "pat@x.test", signupIpHash: null, riskScore: 0 },
        { email: "c@y.test", ipHash: null },
      ).score,
    ).toBe(0);
  });
});
