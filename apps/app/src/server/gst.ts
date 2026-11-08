import type Stripe from "stripe";
import { env } from "./env";

/**
 * India GST on OpenPromoter's own plans. Prices are exclusive (Terms of Service): GST is added on top.
 * Seller in GST_HOME_STATE: buyers there pay CGST 9% + SGST 9%, buyers in other Indian states IGST 18%,
 * buyers outside India nothing (export of services under LUT). Stripe Tax isn't available to Indian
 * accounts, so these are plain Stripe tax rates.
 */
export type BillingRegion = "abroad" | "in_home" | "in_other";

export const gstOn = () => !!(env.GST_TAX_RATE_CGST && env.GST_TAX_RATE_SGST && env.GST_TAX_RATE_IGST);

export function gstRates(region: BillingRegion | null | undefined): string[] {
  if (!gstOn() || !region || region === "abroad") return [];
  return region === "in_home" ? [env.GST_TAX_RATE_CGST!, env.GST_TAX_RATE_SGST!] : [env.GST_TAX_RATE_IGST!];
}

const STATE_NAMES: Record<string, string> = { UP: "UTTAR PRADESH" };

/** The region an address falls in: what the buyer typed at Checkout decides the tax for renewals. */
export function regionOf(address: Stripe.Address | null | undefined): BillingRegion | null {
  if (!address?.country) return null;
  if (address.country !== "IN") return "abroad";
  const state = (address.state ?? "").trim().toUpperCase();
  const home = env.GST_HOME_STATE.toUpperCase();
  return state === home || state === `IN-${home}` || state === STATE_NAMES[home] ? "in_home" : "in_other";
}

/**
 * True when Cloudflare places the visitor outside India (CF-IPCountry). Their business is billed abroad,
 * so the billing location question is skipped; the address typed at Checkout still corrects renewals.
 * Unknown (no header, XX, T1 for Tor) asks the question.
 */
export const outsideIndia = (country: string | null | undefined) => {
  const c = (country ?? "").toUpperCase();
  return /^[A-Z]{2}$/.test(c) && !["IN", "XX", "T1"].includes(c);
};

export const sameRates = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();
