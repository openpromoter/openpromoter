import { createHmac, timingSafeEqual } from "node:crypto";

/** Ids go into the path encoded, so a crafted id can never point a call at another endpoint. */
const e = encodeURIComponent;

export type CommissionStatus = "pending" | "approved" | "held" | "paid" | "reversed";
export type CommissionKind = "sale" | "lead" | "bounty" | "bonus" | "adjustment" | "override";
export type PartnerStatus = "pending" | "approved" | "rejected" | "paused" | "banned";

export interface Partner {
  id: string;
  programId: string;
  name: string;
  email: string;
  status: PartnerStatus;
  code: string;
  groupId: string | null;
  website: string | null;
  country: string | null;
  riskScore: number;
  payoutMethod: string | null;
  /** Two-tier: the partner who recruited this one. */
  recruitedBy: string | null;
  createdAt: string;
}

export interface Commission {
  id: string;
  partnerId: string;
  referralId: string | null;
  kind: CommissionKind;
  /** Two-tier override rows: the sub-partner commission it was earned on. */
  parentCommissionId: string | null;
  status: CommissionStatus;
  saleAmount: number;
  amount: number;
  currency: string;
  holdUntil: string | null;
  payoutId: string | null;
  description: string | null;
  createdAt: string;
}

export interface Payout {
  id: string;
  partnerId: string;
  amount: number;
  currency: string;
  method: "stripe" | "paypal" | "wise" | "manual";
  status: "awaiting_approval" | "processing" | "paid" | "failed" | "canceled";
  invoiceNumber: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface Page<T> {
  data: T[];
  hasMore: boolean;
}

export class OpenPromoterError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "OpenPromoterError";
  }
}

export interface Options {
  apiKey: string;
  /** Your OpenPromoter URL. Defaults to the cloud edition. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | undefined>;

export class OpenPromoter {
  private base: string;
  private key: string;
  private f: typeof fetch;

  constructor(opts: Options) {
    if (!opts?.apiKey) throw new Error("OpenPromoter: apiKey is required");
    this.key = opts.apiKey;
    this.base = `${(opts.baseUrl ?? "https://app.openpromoter.com").replace(/\/$/, "")}/api/v1`;
    this.f = opts.fetch ?? fetch;
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    query?: Query,
  ): Promise<T> {
    const qs = query
      ? Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const res = await this.f(`${this.base}${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        "User-Agent": "openpromoter-node/0.1.0",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code: string; message: string; issues?: { path: string; message: string }[] };
    };
    if (!res.ok)
      throw new OpenPromoterError(
        res.status,
        json.error?.code ?? "http_error",
        json.error?.message ?? `HTTP ${res.status}`,
        json.error?.issues,
      );
    return json as T;
  }

  programs = {
    list: () =>
      this.request<{
        data: { id: string; name: string; slug: string; websiteUrl: string; currency: string }[];
      }>("GET", "/programs"),
    stats: (programId: string, opts: { days?: number } = {}) =>
      this.request<Record<string, number>>("GET", `/programs/${e(programId)}/stats`, undefined, opts),
  };

  partners = {
    list: (
      programId: string,
      opts: { status?: PartnerStatus; recruitedBy?: string; limit?: number; before?: string } = {},
    ) => this.request<Page<Partner>>("GET", `/programs/${e(programId)}/partners`, undefined, opts),
    create: (
      programId: string,
      input: { email: string; name: string; website?: string; country?: string; recruiterCode?: string },
    ) => this.request<Partner>("POST", `/programs/${e(programId)}/partners`, input),
    get: (partnerId: string) =>
      this.request<
        Partner & { links: { id: string; key: string; destination: string; subId: string | null }[] }
      >("GET", `/partners/${e(partnerId)}`),
    update: (partnerId: string, input: { status?: Exclude<PartnerStatus, "pending">; groupId?: string }) =>
      this.request<Partner>("PATCH", `/partners/${e(partnerId)}`, input),
    /** Token for <openpromoter-dashboard> (embeddable partner dashboard inside your app). */
    embedToken: (programId: string, input: { email: string; name: string }) =>
      this.request<{ token: string; partnerId: string; expiresIn: number }>(
        "POST",
        `/programs/${e(programId)}/embed-tokens`,
        input,
      ),
    createLink: (partnerId: string, input: { destination: string; subId?: string; key?: string }) =>
      this.request<{ id: string; key: string; destination: string }>(
        "POST",
        `/partners/${e(partnerId)}/links`,
        input,
      ),
  };

  referrals = {
    list: (programId: string, opts: { status?: string; limit?: number; before?: string } = {}) =>
      this.request<Page<Record<string, unknown>>>(
        "GET",
        `/programs/${e(programId)}/referrals`,
        undefined,
        opts,
      ),
  };

  clicks = {
    create: (input: {
      programId: string;
      code: string;
      url?: string;
      visitorId?: string;
      ip?: string;
      userAgent?: string;
    }) => this.request<{ clickId: string; visitorId: string }>("POST", "/clicks", input),
  };

  /** Record a signup before payment. Pass the visitor's click id (cookie `op_ref`) when you have it. */
  leads = {
    create: (input: {
      programId: string;
      email: string;
      name?: string;
      clickId?: string | null;
      visitorId?: string | null;
      partnerCode?: string | null;
      customerId?: string;
    }) =>
      this.request<{ attributed: boolean; referralId: string | null; partnerId: string | null }>(
        "POST",
        "/leads",
        input,
      ),
  };

  /** For billing systems without a built-in integration. Idempotent on paymentId. */
  conversions = {
    create: (input: {
      programId: string;
      paymentId: string;
      customerId: string;
      amount: number;
      currency: string;
      interval?: "month" | "year";
      email?: string;
      clickId?: string;
      partnerCode?: string;
      promoCode?: string;
      paidAt?: string;
    }) => this.request<{ duplicate: boolean; effects: string[] }>("POST", "/conversions", input),
  };

  refunds = {
    create: (input: {
      programId: string;
      paymentId: string;
      refundId: string;
      refundedTotal: number;
      chargedTotal: number;
    }) => this.request<{ duplicate: boolean; effects: string[] }>("POST", "/refunds", input),
  };

  commissions = {
    list: (
      programId: string,
      opts: {
        status?: CommissionStatus;
        kind?: CommissionKind;
        partnerId?: string;
        limit?: number;
        before?: string;
      } = {},
    ) => this.request<Page<Commission>>("GET", `/programs/${e(programId)}/commissions`, undefined, opts),
    create: (
      programId: string,
      input: { partnerId: string; amount: number; description: string; idempotencyKey?: string },
      // a repeated idempotencyKey returns { duplicate: true } instead of a second commission
    ) =>
      this.request<Commission | { duplicate: true }>("POST", `/programs/${e(programId)}/commissions`, input),
  };

  /** Payouts prepared through the API always wait for a person to approve them in the dashboard. */
  payouts = {
    list: (programId: string, opts: { status?: Payout["status"]; limit?: number; before?: string } = {}) =>
      this.request<Page<Payout>>("GET", `/programs/${e(programId)}/payouts`, undefined, opts),
    prepare: (programId: string, input: { partnerIds?: string[] } = {}) =>
      this.request<{ data: Payout[]; approvalRequired: true }>(
        "POST",
        `/programs/${e(programId)}/payouts`,
        input,
      ),
  };

  campaigns = {
    list: (programId: string) =>
      this.request<{ data: Record<string, unknown>[] }>("GET", `/programs/${e(programId)}/campaigns`),
    create: (programId: string, input: { prompt: string; launch?: boolean }) =>
      this.request<Record<string, unknown>>("POST", `/programs/${e(programId)}/campaigns`, input),
  };

  autopilot = {
    list: (programId: string) =>
      this.request<{ data: Record<string, unknown>[] }>("GET", `/programs/${e(programId)}/autopilot`),
    apply: (programId: string, actionId: string) =>
      this.request<Record<string, unknown>>(
        "POST",
        `/programs/${e(programId)}/autopilot/${e(actionId)}/apply`,
      ),
  };

  events = {
    list: (opts: { after?: string; limit?: number } = {}) =>
      this.request<{ data: WebhookEvent[] }>("GET", "/events", undefined, opts),
  };

  ask = (programId: string, question: string) =>
    this.request<{ text: string; links: { label: string; href: string }[]; rows: unknown[] }>(
      "POST",
      `/programs/${e(programId)}/ask`,
      { question },
    );
}

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  created: number;
  data: T;
}

/**
 * Verify an OpenPromoter webhook. Header: `OpenPromoter-Signature: t=<unix>,v1=<hex>`,
 * where v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Throws on a bad or stale signature.
 */
export function verifyWebhook<T = Record<string, unknown>>(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  toleranceSeconds = 300,
): WebhookEvent<T> {
  if (!header) throw new OpenPromoterError(400, "invalid_signature", "Missing OpenPromoter-Signature header");
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1) throw new OpenPromoterError(400, "invalid_signature", "Malformed signature header");
  if (Math.abs(Date.now() / 1000 - t) > toleranceSeconds)
    throw new OpenPromoterError(400, "invalid_signature", "Signature timestamp outside tolerance");
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    throw new OpenPromoterError(400, "invalid_signature", "Invalid signature");
  return JSON.parse(rawBody) as WebhookEvent<T>;
}

export interface ReferralCookie {
  clickId: string | null;
  visitorId: string | null;
  code: string | null;
}

/** Read the first-party `op_ref` cookie set by op.js from a Cookie header. */
export function readReferralCookie(cookieHeader: string | null | undefined): ReferralCookie | null {
  const m = cookieHeader?.match(/(?:^|;\s*)op_ref=([^;]*)/);
  if (!m?.[1]) return null;
  try {
    const v = JSON.parse(decodeURIComponent(m[1])) as { c?: string; v?: string; p?: string };
    return { clickId: v.c ?? null, visitorId: v.v ?? null, code: v.p ?? null };
  } catch {
    return null;
  }
}

/**
 * Auth-provider helper: call it from your signup hook (Better Auth `databaseHooks.user.create.after`,
 * NextAuth `events.createUser`, Clerk `user.created` webhook, Supabase auth hook) with the request's
 * Cookie header. It records the lead and never throws, so signups never fail because of tracking.
 */
export async function trackSignup(
  op: OpenPromoter,
  input: {
    programId: string;
    email: string;
    name?: string;
    cookieHeader?: string | null;
    customerId?: string;
  },
) {
  const ref = readReferralCookie(input.cookieHeader);
  try {
    return await op.leads.create({
      programId: input.programId,
      email: input.email,
      name: input.name,
      clickId: ref?.clickId,
      visitorId: ref?.visitorId,
      partnerCode: ref?.code,
      customerId: input.customerId,
    });
  } catch {
    return { attributed: false, referralId: null, partnerId: null };
  }
}

/** Metadata to put on Stripe Checkout Sessions so the sale is attributed without cookies. */
export function stripeCheckoutParams(ref: ReferralCookie | null): {
  client_reference_id?: string;
  metadata?: Record<string, string>;
  subscription_data?: { metadata: Record<string, string> };
} {
  if (!ref?.clickId) return {};
  const md = { op_click: ref.clickId, ...(ref.code ? { op_ref: ref.code } : {}) };
  return { client_reference_id: ref.clickId, metadata: md, subscription_data: { metadata: md } };
}
