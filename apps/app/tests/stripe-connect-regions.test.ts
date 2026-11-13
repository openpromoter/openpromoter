import { describe, expect, it } from "vitest";
import { connectCanPay } from "@/server/stripe-service";

// https://docs.stripe.com/connect/cross-border-payouts (read 2026-11-13)
describe("which partners a founder's Stripe can pay through Connect", () => {
  it("pays across borders between the US, Canada, the UK, the EEA and Switzerland", () => {
    expect(connectCanPay("US", "GB")).toBe(true);
    expect(connectCanPay("DE", "CA")).toBe(true);
    expect(connectCanPay("GB", "NO")).toBe(true);
    expect(connectCanPay("CH", "FR")).toBe(true);
  });

  it("pays in the same country anywhere and refuses other borders", () => {
    expect(connectCanPay("AU", "AU")).toBe(true);
    expect(connectCanPay("US", "IN")).toBe(false);
    expect(connectCanPay("AU", "US")).toBe(false);
    expect(connectCanPay("SG", "GB")).toBe(false);
  });
});
