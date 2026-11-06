/** Pure attribution rules. DB access lives in ingest.ts. */

export interface ClickLike {
  id: string;
  partnerId: string;
  programId: string;
  createdAt: Date;
}

export type AttributionModel = "first_click" | "last_click";

/** Choose the click that earns the referral among a visitor's clicks inside the cookie window. */
export function pickClick<T extends ClickLike>(
  clicks: T[],
  model: AttributionModel,
  now: Date,
  windowDays: number,
): T | null {
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const live = clicks.filter(
    (c) => c.createdAt.getTime() >= cutoff && c.createdAt.getTime() <= now.getTime(),
  );
  if (live.length === 0) return null;
  live.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return model === "first_click" ? live[0]! : live[live.length - 1]!;
}

export interface AttributionHints {
  /** Promotion / coupon code used at checkout */
  promoCode?: string | null;
  /** Our click id, from client_reference_id or metadata.op_click */
  clickId?: string | null;
  /** Partner referral code from metadata.op_ref */
  partnerCode?: string | null;
  /** Visitor id from metadata.op_visitor or the lead record */
  visitorId?: string | null;
  email?: string | null;
}

export type AttributionSource = "coupon" | "metadata" | "link" | "lead";

/**
 * Order of precedence. A coupon is the customer's explicit choice, so it wins;
 * then the click id we put on the checkout; then a partner code; then the
 * visitor's click history; then a lead captured earlier with the same email.
 */
export const ATTRIBUTION_ORDER: { key: keyof AttributionHints; source: AttributionSource }[] = [
  { key: "promoCode", source: "coupon" },
  { key: "clickId", source: "link" },
  { key: "partnerCode", source: "metadata" },
  { key: "visitorId", source: "link" },
  { key: "email", source: "lead" },
];

/** Parse "op_click=clk_x" style hints from Stripe client_reference_id or metadata. */
export function hintsFromStripe(input: {
  clientReferenceId?: string | null;
  metadata?: Record<string, string> | null;
  promoCode?: string | null;
  email?: string | null;
}): AttributionHints {
  const md = input.metadata ?? {};
  const ref = input.clientReferenceId ?? "";
  return {
    promoCode: input.promoCode ?? null,
    clickId: ref.startsWith("clk_") ? ref : (md.op_click ?? md.openpromoter_click ?? null),
    partnerCode: md.op_ref ?? md.openpromoter_ref ?? md.via ?? null,
    visitorId: md.op_visitor ?? (ref.startsWith("vis_") ? ref : null),
    email: input.email ?? null,
  };
}

/** UTM and sub-id capture from a landing URL. */
export function parseLanding(
  url: string | null | undefined,
  param = "via",
): {
  code: string | null;
  subId: string | null;
  utm: Record<string, string>;
} {
  const utm: Record<string, string> = {};
  if (!url) return { code: null, subId: null, utm };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { code: null, subId: null, utm };
  }
  for (const [k, v] of u.searchParams) if (k.startsWith("utm_") && v) utm[k] = v.slice(0, 200);
  const code =
    u.searchParams.get(param) ??
    u.searchParams.get("ref") ??
    u.searchParams.get("via") ??
    u.searchParams.get("fpr") ??
    u.searchParams.get("gspk");
  return {
    code: code ? code.slice(0, 64) : null,
    subId: u.searchParams.get("sub")?.slice(0, 64) ?? null,
    utm,
  };
}
