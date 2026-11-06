/**
 * Fraud scoring. Each detector returns a signal with a score 0-100; signals are
 * combined with noisy-OR so several weak signals add up without exceeding 100.
 */

export type FraudSignalKind =
  | "self_referral"
  | "same_ip_as_partner"
  | "duplicate_accounts"
  | "coupon_leak"
  | "brand_bidding"
  | "click_spam"
  | "bot_traffic"
  | "refund_after_payout"
  | "fast_churn"
  | "duplicate_payout_method"
  | "self_recruit";

export interface FraudSignal {
  kind: FraudSignalKind;
  score: number;
  detail: string;
  referralId?: string | null;
}

export const SIGNAL_LABELS: Record<FraudSignalKind, string> = {
  self_referral: "Self-referral",
  same_ip_as_partner: "Same network as partner",
  duplicate_accounts: "Duplicate accounts",
  coupon_leak: "Coupon leaking",
  brand_bidding: "Paid ads on your brand",
  click_spam: "Suspicious click pattern",
  bot_traffic: "Bot traffic",
  refund_after_payout: "Refunds after payout",
  fast_churn: "Customers cancel fast",
  duplicate_payout_method: "Payout account shared with another partner",
  self_recruit: "Recruited own account",
};

export function combineScores(scores: number[]): number {
  const clean = 1 - scores.reduce((acc, s) => acc * (1 - Math.min(100, Math.max(0, s)) / 100), 1);
  return Math.round(clean * 100);
}

/** Lowercase, strip "+tag" and gmail dots so aliases of one inbox compare equal. */
export function normalizeEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const d = domain === "googlemail.com" ? "gmail.com" : domain;
  let l = local.split("+")[0] ?? "";
  if (d === "gmail.com") l = l.replace(/\./g, "");
  return `${l}@${d}`;
}

const BOT_UA =
  /bot|crawl|spider|slurp|headless|phantom|python-requests|curl\/|wget|httpclient|scrapy|facebookexternalhit|preview/i;
export const isBotUserAgent = (ua: string | null | undefined) => !ua || BOT_UA.test(ua);

const PAID_SEARCH_PARAMS = ["gclid", "gbraid", "wbraid", "msclkid", "dclid"];
const SEARCH_REFERRERS = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia)\./i;

/** A click that came from a paid search ad (brand bidding when it lands on the founder's site). */
export function isPaidSearchClick(c: {
  landingUrl?: string | null;
  referrer?: string | null;
  utm?: Record<string, string> | null;
}): boolean {
  let params: URLSearchParams | null = null;
  try {
    params = c.landingUrl ? new URL(c.landingUrl).searchParams : null;
  } catch {
    params = null;
  }
  if (params && PAID_SEARCH_PARAMS.some((p) => params!.has(p))) return true;
  const medium = (c.utm?.utm_medium ?? params?.get("utm_medium") ?? "").toLowerCase();
  let refHost = "";
  try {
    refHost = c.referrer ? new URL(c.referrer).hostname : "";
  } catch {
    refHost = "";
  }
  return ["cpc", "ppc", "paid", "paidsearch", "sem"].includes(medium) && SEARCH_REFERRERS.test(refHost);
}

export interface PartnerFacts {
  partnerEmail: string;
  partnerSignupIpHash: string | null;
  referrals: {
    id: string;
    email: string | null;
    ipHash: string | null;
    via: string;
    status: string;
    createdAt: Date;
    canceledAt: Date | null;
  }[];
  clicks: {
    visitorId: string;
    ipHash: string | null;
    userAgent: string | null;
    landingUrl: string | null;
    referrer: string | null;
    utm: Record<string, string> | null;
    isBot: boolean;
  }[];
  paidCommissions: number;
  refundedAfterPayout: number;
}

export function detectSignals(f: PartnerFacts): FraudSignal[] {
  const out: FraudSignal[] = [];
  const partnerEmail = normalizeEmail(f.partnerEmail);

  for (const r of f.referrals) {
    if (r.email && normalizeEmail(r.email) === partnerEmail) {
      out.push({
        kind: "self_referral",
        score: 95,
        detail: "The customer email matches the partner's own email.",
        referralId: r.id,
      });
    } else if (f.partnerSignupIpHash && r.ipHash && r.ipHash === f.partnerSignupIpHash) {
      out.push({
        kind: "same_ip_as_partner",
        score: 75,
        detail: "The customer signed up from the same network the partner applied from.",
        referralId: r.id,
      });
    }
  }

  const byIp = new Map<string, number>();
  for (const r of f.referrals) if (r.ipHash) byIp.set(r.ipHash, (byIp.get(r.ipHash) ?? 0) + 1);
  const dupes = [...byIp.values()].filter((n) => n >= 3).reduce((a, b) => a + b, 0);
  if (dupes > 0) {
    out.push({
      kind: "duplicate_accounts",
      score: Math.min(80, 40 + dupes * 5),
      detail: `${dupes} referred accounts share a network with at least two others.`,
    });
  }

  const couponOnly = f.referrals.filter((r) => r.via === "coupon").length;
  if (f.referrals.length >= 5 && couponOnly / f.referrals.length >= 0.8 && f.clicks.length < couponOnly) {
    out.push({
      kind: "coupon_leak",
      score: 45,
      detail: `${couponOnly} of ${f.referrals.length} referrals used the partner's coupon without clicking a link. The code may be on a coupon site.`,
    });
  }

  const paid = f.clicks.filter(isPaidSearchClick).length;
  if (paid >= 3) {
    out.push({
      kind: "brand_bidding",
      score: Math.min(85, 50 + paid * 2),
      detail: `${paid} clicks came from paid search ads.`,
    });
  }

  const bots = f.clicks.filter((c) => c.isBot || isBotUserAgent(c.userAgent)).length;
  if (f.clicks.length >= 20 && bots / f.clicks.length >= 0.3) {
    out.push({
      kind: "bot_traffic",
      score: 50,
      detail: `${Math.round((bots / f.clicks.length) * 100)}% of clicks look automated.`,
    });
  }

  const perVisitor = new Map<string, number>();
  for (const c of f.clicks) {
    const k = c.ipHash ?? c.visitorId;
    perVisitor.set(k, (perVisitor.get(k) ?? 0) + 1);
  }
  const heavy = [...perVisitor.values()].filter((n) => n >= 25).length;
  if (heavy > 0 || (f.clicks.length >= 1000 && f.referrals.length === 0)) {
    out.push({
      kind: "click_spam",
      score: heavy > 0 ? 55 : 35,
      detail:
        heavy > 0 ? `${heavy} visitors clicked 25+ times.` : `${f.clicks.length} clicks and no signups.`,
    });
  }

  if (f.paidCommissions >= 3 && f.refundedAfterPayout / f.paidCommissions >= 0.3) {
    out.push({
      kind: "refund_after_payout",
      score: 60,
      detail: `${f.refundedAfterPayout} of ${f.paidCommissions} paid commissions were refunded later.`,
    });
  }

  const churned = f.referrals.filter(
    (r) => r.canceledAt && r.canceledAt.getTime() - r.createdAt.getTime() < 7 * 86_400_000,
  ).length;
  if (f.referrals.length >= 5 && churned / f.referrals.length >= 0.5) {
    out.push({
      kind: "fast_churn",
      score: 40,
      detail: `${churned} referred customers canceled within a week.`,
    });
  }

  return out;
}

export function scorePartner(f: PartnerFacts): { score: number; signals: FraudSignal[] } {
  const signals = detectSignals(f);
  return { score: combineScores(signals.map((s) => s.score)), signals };
}

/** Score for a single new referral, used to decide whether its commission is held. */
export function scoreReferral(
  partner: { email: string; signupIpHash: string | null; riskScore: number },
  r: { email: string | null; ipHash: string | null },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const parts: number[] = [partner.riskScore];
  if (r.email && normalizeEmail(r.email) === normalizeEmail(partner.email)) {
    parts.push(95);
    reasons.push("self-referral");
  }
  if (partner.signupIpHash && r.ipHash && partner.signupIpHash === r.ipHash) {
    parts.push(75);
    reasons.push("same network as partner");
  }
  return { score: combineScores(parts), reasons };
}

type RecruitSide = {
  email: string;
  userId: string | null;
  signupIpHash: string | null;
  paypalEmail: string | null;
  wiseEmail: string | null;
};

/** Two-tier: the same person on both sides of a recruit (email, login, signup network or payout account). */
export function selfRecruited(recruiter: RecruitSide, sub: RecruitSide): string | null {
  if (normalizeEmail(recruiter.email) === normalizeEmail(sub.email)) return "same email";
  if (recruiter.userId && recruiter.userId === sub.userId) return "same login";
  if (recruiter.signupIpHash && recruiter.signupIpHash === sub.signupIpHash) return "same network";
  const pay = (x: RecruitSide) =>
    [x.paypalEmail, x.wiseEmail].filter((e): e is string => !!e).map((e) => e.toLowerCase());
  const mine = pay(recruiter);
  if (pay(sub).some((e) => mine.includes(e))) return "same payout account";
  return null;
}
