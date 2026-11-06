import {
  agentAction,
  apiKey,
  campaign,
  commission,
  eventLog,
  link,
  partner,
  partnerGroup,
  payout,
  program,
  referral,
} from "@openpromoter/db";
import { and, asc, desc, eq, gt, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { sha256 } from "@/lib/crypto";
import type { ApiScope } from "@/lib/scopes";
import { HTTP_URL } from "@/lib/url";
import { ask } from "./ai/assistant";
import { applyAction } from "./ai/autopilot";
import { overview, parseRange } from "./analytics";
import type { Actor } from "./audit";
import { createCampaign, draftCampaign } from "./campaigns";
import { db } from "./db";
import { signEmbedToken } from "./embed";
import { ingest } from "./ingest";
import { createManualCommission } from "./ledger";
import { applyToProgram, createLink, setPartnerStatus } from "./partners";
import { createPayoutBatch } from "./payouts";
import { limit } from "./ratelimit";
import { recordClick, recordLead } from "./tracking";

/** Newest first by creation time; `before` is the id of the last row on the previous page. */
function newestFirst(
  t: typeof partner | typeof referral | typeof commission | typeof payout,
  before?: string,
) {
  return {
    cursor: before
      ? sql`(${t.createdAt}, ${t.id}) < (select created_at, id from ${t} where id = ${before})`
      : undefined,
    order: [desc(t.createdAt), desc(t.id)] as const,
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiCtx {
  workspaceId: string;
  keyId: string;
  scopes: string[];
  actor: Actor;
}

export async function authenticate(req: Request): Promise<ApiCtx> {
  const h = req.headers.get("authorization") ?? "";
  const raw = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
  if (!raw) throw new ApiError(401, "unauthorized", "Missing Bearer API key");
  const [k] = await db()
    .select()
    .from(apiKey)
    .where(eq(apiKey.hash, sha256(raw)));
  if (!k || k.revokedAt) throw new ApiError(401, "unauthorized", "Invalid API key");
  if (!(await limit(`api:${k.id}`, 600, 60_000)).ok)
    throw new ApiError(429, "rate_limited", "Too many requests (600/min per key)");
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000)
    await db().update(apiKey).set({ lastUsedAt: new Date() }).where(eq(apiKey.id, k.id));
  return { workspaceId: k.workspaceId, keyId: k.id, scopes: k.scopes, actor: { type: "api_key", id: k.id } };
}

async function programFor(ctx: ApiCtx, programId: string) {
  const [p] = await db()
    .select()
    .from(program)
    .where(and(eq(program.id, programId), eq(program.workspaceId, ctx.workspaceId)));
  if (!p) throw new ApiError(404, "not_found", "Program not found");
  return p;
}

async function partnerFor(ctx: ApiCtx, partnerId: string) {
  const [p] = await db()
    .select()
    .from(partner)
    .where(and(eq(partner.id, partnerId), eq(partner.workspaceId, ctx.workspaceId)));
  if (!p) throw new ApiError(404, "not_found", "Partner not found");
  return p;
}

const page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().optional(),
});

const pub = {
  partner: (p: typeof partner.$inferSelect) => ({
    id: p.id,
    programId: p.programId,
    name: p.name,
    email: p.email,
    status: p.status,
    code: p.code,
    groupId: p.groupId,
    website: p.website,
    country: p.country,
    riskScore: p.riskScore,
    payoutMethod: p.payoutMethod,
    recruitedBy: p.recruitedBy,
    createdAt: p.createdAt,
  }),
  commission: (c: typeof commission.$inferSelect) => ({
    id: c.id,
    partnerId: c.partnerId,
    referralId: c.referralId,
    kind: c.kind,
    parentCommissionId: c.parentId,
    status: c.status,
    saleAmount: c.saleAmount,
    amount: c.amount,
    currency: c.currency,
    holdUntil: c.holdUntil,
    payoutId: c.payoutId,
    description: c.description,
    createdAt: c.createdAt,
  }),
  payout: (p: typeof payout.$inferSelect) => ({
    id: p.id,
    partnerId: p.partnerId,
    amount: p.amount,
    currency: p.currency,
    method: p.method,
    status: p.status,
    invoiceNumber: p.invoiceNumber,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
  }),
};

export interface Route {
  method: "GET" | "POST" | "PATCH";
  path: string;
  scope: ApiScope;
  summary: string;
  tag: string;
  query?: z.ZodObject;
  body?: z.ZodObject;
  handler: (
    ctx: ApiCtx,
    input: { params: Record<string, string>; query: any; body: any },
  ) => Promise<unknown>;
}

const conversionBody = z.object({
  programId: z.string(),
  paymentId: z.string().max(120).describe("Your unique id for this payment (idempotency key)"),
  customerId: z.string().max(120),
  amount: z.number().int().positive().max(2_147_483_647).describe("Amount paid in minor units excluding tax"),
  currency: z.string().length(3),
  interval: z.enum(["month", "year"]).nullish(),
  email: z.email().nullish(),
  clickId: z.string().max(40).nullish(),
  partnerCode: z.string().max(64).nullish(),
  promoCode: z.string().max(64).nullish(),
  paidAt: z.iso.datetime().nullish(),
});

export const ROUTES: Route[] = [
  {
    method: "GET",
    path: "/events",
    scope: "read",
    tag: "Events",
    summary:
      "Events (same payloads as webhooks) after a cursor with the oldest first. Used by `openpromoter listen`.",
    query: z.object({
      after: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    handler: async (ctx, { query }) => {
      const w: SQL[] = [eq(eventLog.workspaceId, ctx.workspaceId)];
      if (query.after) w.push(gt(eventLog.id, query.after));
      const rows = await db()
        .select()
        .from(eventLog)
        .where(and(...w))
        .orderBy(asc(eventLog.id))
        .limit(query.limit);
      return {
        data: rows.map((r) => ({
          id: r.id,
          type: r.type,
          created: Math.floor(r.createdAt.getTime() / 1000),
          data: r.data,
        })),
      };
    },
  },
  {
    method: "GET",
    path: "/programs",
    scope: "read",
    tag: "Programs",
    summary: "List programs in the workspace",
    handler: async (ctx) => ({
      data: (await db().select().from(program).where(eq(program.workspaceId, ctx.workspaceId))).map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        websiteUrl: p.websiteUrl,
        currency: p.currency,
        commissionType: p.commissionType,
        commissionValue: p.commissionValue,
        commissionDuration: p.commissionDuration,
        cookieDays: p.cookieDays,
        overrideRate: p.overrideRate,
        category: p.category,
        listedInNetwork: p.listedInNetwork,
      })),
    }),
  },
  {
    method: "GET",
    path: "/programs/{programId}/stats",
    scope: "read",
    tag: "Programs",
    summary: "Totals for a period (revenue, commissions, clicks, signups, customers, MRR, owed)",
    query: z.object({ days: z.coerce.number().int().min(1).max(730).default(30) }),
    handler: async (ctx, { params, query }) => {
      await programFor(ctx, params.programId!);
      return overview(params.programId!, parseRange({ days: String(query.days) }));
    },
  },
  {
    method: "GET",
    path: "/programs/{programId}/partners",
    scope: "read",
    tag: "Partners",
    summary: "List partners with the newest first",
    query: page.extend({
      status: z.enum(["pending", "approved", "rejected", "paused", "banned"]).optional(),
      recruitedBy: z.string().optional().describe("Two-tier: only partners recruited by this partner id"),
    }),
    handler: async (ctx, { params, query }) => {
      await programFor(ctx, params.programId!);
      const w: SQL[] = [eq(partner.programId, params.programId!)];
      if (query.status) w.push(eq(partner.status, query.status));
      if (query.recruitedBy) w.push(eq(partner.recruitedBy, query.recruitedBy));
      const page = newestFirst(partner, query.before);
      if (page.cursor) w.push(page.cursor);
      const rows = await db()
        .select()
        .from(partner)
        .where(and(...w))
        .orderBy(...page.order)
        .limit(query.limit);
      return { data: rows.map(pub.partner), hasMore: rows.length === query.limit };
    },
  },
  {
    method: "POST",
    path: "/programs/{programId}/partners",
    scope: "partners:write",
    tag: "Partners",
    summary: "Invite (create and approve) a partner",
    body: z.object({
      email: z.email(),
      name: z.string().min(1).max(120),
      website: z.string().max(300).nullish(),
      country: z.string().length(2).nullish(),
      recruiterCode: z
        .string()
        .max(64)
        .nullish()
        .describe("Two-tier: code of the approved partner who recruited this one"),
    }),
    handler: async (ctx, { params, body }) => {
      const p = await programFor(ctx, params.programId!);
      const r = await applyToProgram(p, { ...body, source: "api" }, true);
      return pub.partner(r.partner);
    },
  },
  {
    method: "GET",
    path: "/partners/{partnerId}",
    scope: "read",
    tag: "Partners",
    summary: "Get a partner with links",
    handler: async (ctx, { params }) => {
      const p = await partnerFor(ctx, params.partnerId!);
      const links = await db().select().from(link).where(eq(link.partnerId, p.id));
      return {
        ...pub.partner(p),
        links: links.map((l) => ({ id: l.id, key: l.key, destination: l.destination, subId: l.subId })),
      };
    },
  },
  {
    method: "PATCH",
    path: "/partners/{partnerId}",
    scope: "partners:write",
    tag: "Partners",
    summary: "Change a partner's status or tier",
    body: z.object({
      status: z.enum(["approved", "rejected", "paused", "banned"]).optional(),
      groupId: z.string().optional(),
    }),
    handler: async (ctx, { params, body }) => {
      const p = await partnerFor(ctx, params.partnerId!);
      if (body.status) await setPartnerStatus(p.programId, [p.id], body.status, ctx.actor);
      if (body.groupId) {
        const [g] = await db()
          .select({ id: partnerGroup.id })
          .from(partnerGroup)
          .where(and(eq(partnerGroup.id, body.groupId), eq(partnerGroup.programId, p.programId)));
        if (!g) throw new ApiError(404, "not_found", "Tier not found in this program");
        await db().update(partner).set({ groupId: g.id }).where(eq(partner.id, p.id));
      }
      return pub.partner(await partnerFor(ctx, p.id));
    },
  },
  {
    method: "POST",
    path: "/partners/{partnerId}/links",
    scope: "partners:write",
    tag: "Partners",
    summary: "Create a short or deep link for a partner",
    body: z.object({
      destination: z.url(HTTP_URL),
      subId: z.string().max(64).nullish(),
      key: z.string().max(32).nullish(),
    }),
    handler: async (ctx, { params, body }) => {
      const p = await partnerFor(ctx, params.partnerId!);
      return createLink(p.programId, p.id, body);
    },
  },
  {
    method: "POST",
    path: "/programs/{programId}/embed-tokens",
    scope: "partners:write",
    tag: "Partners",
    summary:
      "Mint a 1-hour token for the embeddable partner dashboard. Creates (and approves) the partner if needed so customers can refer from inside your app.",
    body: z.object({ email: z.email(), name: z.string().min(1).max(120) }),
    handler: async (ctx, { params, body }) => {
      const p = await programFor(ctx, params.programId!);
      const r = await applyToProgram(p, { email: body.email, name: body.name, source: "api" }, true);
      return { token: signEmbedToken(r.partner.id), partnerId: r.partner.id, expiresIn: 3600 };
    },
  },
  {
    method: "GET",
    path: "/programs/{programId}/referrals",
    scope: "read",
    tag: "Tracking",
    summary: "List referred signups and customers",
    query: page.extend({ status: z.enum(["lead", "trialing", "active", "canceled", "refunded"]).optional() }),
    handler: async (ctx, { params, query }) => {
      await programFor(ctx, params.programId!);
      const w: SQL[] = [eq(referral.programId, params.programId!)];
      if (query.status) w.push(eq(referral.status, query.status));
      const page = newestFirst(referral, query.before);
      if (page.cursor) w.push(page.cursor);
      const rows = await db()
        .select()
        .from(referral)
        .where(and(...w))
        .orderBy(...page.order)
        .limit(query.limit);
      return {
        data: rows.map((r) => ({
          id: r.id,
          partnerId: r.partnerId,
          email: r.email,
          customerId: r.externalCustomerId,
          status: r.status,
          via: r.via,
          revenue: r.revenue,
          mrr: r.mrr,
          createdAt: r.createdAt,
          convertedAt: r.convertedAt,
        })),
        hasMore: rows.length === query.limit,
      };
    },
  },
  {
    method: "POST",
    path: "/clicks",
    scope: "tracking:write",
    tag: "Tracking",
    summary: "Record a click server-side (e.g. from your own redirect)",
    body: z.object({
      programId: z.string(),
      code: z.string().max(64),
      url: z.string().max(2000).nullish(),
      visitorId: z.string().max(40).nullish(),
      ip: z.string().max(64).nullish(),
      userAgent: z.string().max(400).nullish(),
    }),
    handler: async (ctx, { body }) => {
      await programFor(ctx, body.programId);
      const r = await recordClick({
        programId: body.programId,
        code: body.code,
        landingUrl: body.url,
        visitorId: body.visitorId,
        ip: body.ip,
        userAgent: body.userAgent,
      });
      if (!r) throw new ApiError(404, "not_found", "No active partner with that code");
      return r;
    },
  },
  {
    method: "POST",
    path: "/leads",
    scope: "tracking:write",
    tag: "Tracking",
    summary: "Record a signup (lead) before payment",
    body: z.object({
      programId: z.string(),
      email: z.email(),
      name: z.string().max(120).nullish(),
      clickId: z.string().max(40).nullish(),
      visitorId: z.string().max(40).nullish(),
      partnerCode: z.string().max(64).nullish(),
      customerId: z.string().max(120).nullish(),
    }),
    handler: async (ctx, { body }) => {
      await programFor(ctx, body.programId);
      const r = await recordLead({
        programId: body.programId,
        email: body.email,
        name: body.name,
        clickId: body.clickId,
        visitorId: body.visitorId,
        partnerCode: body.partnerCode,
        externalCustomerId: body.customerId,
      });
      return { attributed: !!r, referralId: r?.id ?? null, partnerId: r?.partnerId ?? null };
    },
  },
  {
    method: "POST",
    path: "/conversions",
    scope: "tracking:write",
    tag: "Tracking",
    summary:
      "Record a payment from a billing system without a built-in integration. Idempotent on paymentId.",
    body: conversionBody,
    handler: async (ctx, { body }) => {
      await programFor(ctx, body.programId);
      const res = await ingest(ctx.workspaceId, "api", {
        eventId: `conversion:${body.paymentId}`,
        eventType: "api.conversion",
        livemode: true,
        events: [
          {
            type: "payment",
            paymentId: body.paymentId,
            chargeIds: [body.paymentId],
            customerId: body.customerId,
            email: body.email ?? null,
            subscriptionId: null,
            amount: body.amount,
            currency: body.currency.toLowerCase(),
            interval: body.interval ?? null,
            intervalCount: 1,
            paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
            attribution: {
              clientReferenceId: body.clickId,
              metadata: body.partnerCode ? { op_ref: body.partnerCode } : {},
              promoCode: body.promoCode,
              email: body.email,
            },
            description: "Payment (API)",
          },
        ],
      });
      return { duplicate: res.duplicate, effects: res.effects };
    },
  },
  {
    method: "POST",
    path: "/refunds",
    scope: "tracking:write",
    tag: "Tracking",
    summary: "Report a refund for a payment sent to /conversions",
    body: z.object({
      programId: z.string(),
      paymentId: z.string(),
      refundId: z.string(),
      refundedTotal: z
        .number()
        .int()
        .nonnegative()
        .max(2_147_483_647)
        .describe("Total refunded so far in minor units"),
      chargedTotal: z.number().int().positive().max(2_147_483_647),
    }),
    handler: async (ctx, { body }) => {
      await programFor(ctx, body.programId);
      const res = await ingest(ctx.workspaceId, "api", {
        eventId: `refund:${body.refundId}`,
        eventType: "api.refund",
        livemode: true,
        events: [
          {
            type: "refund",
            chargeId: body.paymentId,
            refundKey: body.refundId,
            refunded: body.refundedTotal,
            charged: body.chargedTotal,
          },
        ],
      });
      return { duplicate: res.duplicate, effects: res.effects };
    },
  },
  {
    method: "GET",
    path: "/programs/{programId}/commissions",
    scope: "read",
    tag: "Money",
    summary: "List commissions (the ledger)",
    query: page.extend({
      status: z.enum(["pending", "approved", "held", "paid", "reversed"]).optional(),
      kind: z.enum(["sale", "lead", "bounty", "bonus", "adjustment", "override"]).optional(),
      partnerId: z.string().optional(),
    }),
    handler: async (ctx, { params, query }) => {
      await programFor(ctx, params.programId!);
      const w: SQL[] = [eq(commission.programId, params.programId!)];
      if (query.status) w.push(eq(commission.status, query.status));
      if (query.kind) w.push(eq(commission.kind, query.kind));
      if (query.partnerId) w.push(eq(commission.partnerId, query.partnerId));
      const page = newestFirst(commission, query.before);
      if (page.cursor) w.push(page.cursor);
      const rows = await db()
        .select()
        .from(commission)
        .where(and(...w))
        .orderBy(...page.order)
        .limit(query.limit);
      return { data: rows.map(pub.commission), hasMore: rows.length === query.limit };
    },
  },
  {
    method: "POST",
    path: "/programs/{programId}/commissions",
    scope: "commissions:write",
    tag: "Money",
    summary: "Add a manual commission or bonus (approved immediately). Idempotent with idempotencyKey.",
    body: z.object({
      partnerId: z.string(),
      amount: z
        .number()
        .int()
        .min(-2_147_483_647)
        .max(2_147_483_647)
        .refine((n) => n !== 0, "A commission can't be zero"),
      description: z.string().min(1).max(200),
      idempotencyKey: z.string().max(120).optional(),
    }),
    handler: async (ctx, { params, body }) => {
      await programFor(ctx, params.programId!);
      const c = await createManualCommission(
        params.programId!,
        {
          partnerId: body.partnerId,
          amount: body.amount,
          description: body.description,
          kind: body.amount < 0 ? "adjustment" : "bonus",
          sourceKey: body.idempotencyKey ? `api:${body.idempotencyKey}` : undefined,
        },
        ctx.actor,
      );
      return c ? pub.commission(c) : { duplicate: true };
    },
  },
  {
    method: "GET",
    path: "/programs/{programId}/payouts",
    scope: "read",
    tag: "Money",
    summary: "List payouts",
    query: page.extend({
      status: z.enum(["awaiting_approval", "processing", "paid", "failed", "canceled"]).optional(),
    }),
    handler: async (ctx, { params, query }) => {
      await programFor(ctx, params.programId!);
      const w: SQL[] = [eq(payout.programId, params.programId!)];
      if (query.status) w.push(eq(payout.status, query.status));
      const page = newestFirst(payout, query.before);
      if (page.cursor) w.push(page.cursor);
      const rows = await db()
        .select()
        .from(payout)
        .where(and(...w))
        .orderBy(...page.order)
        .limit(query.limit);
      return { data: rows.map(pub.payout), hasMore: rows.length === query.limit };
    },
  },
  {
    method: "POST",
    path: "/programs/{programId}/payouts",
    scope: "payouts:request",
    tag: "Money",
    summary:
      "Prepare payouts for partners over the minimum. They wait for a person to approve them in the dashboard; no money moves.",
    body: z.object({ partnerIds: z.array(z.string()).max(500).optional() }),
    handler: async (ctx, { params, body }) => {
      await programFor(ctx, params.programId!);
      const batch = await createPayoutBatch(params.programId!, ctx.actor, body.partnerIds);
      return { data: batch.map(pub.payout), approvalRequired: true };
    },
  },
  {
    method: "GET",
    path: "/programs/{programId}/campaigns",
    scope: "read",
    tag: "Growth",
    summary: "List campaigns",
    handler: async (ctx, { params }) => {
      await programFor(ctx, params.programId!);
      return {
        data: await db()
          .select()
          .from(campaign)
          .where(eq(campaign.programId, params.programId!))
          .orderBy(desc(campaign.createdAt))
          .limit(200),
      };
    },
  },
  {
    method: "POST",
    path: "/programs/{programId}/campaigns",
    scope: "partners:write",
    tag: "Growth",
    summary: 'Create a campaign from one sentence (e.g. "double commissions for annual plans this month")',
    body: z.object({ prompt: z.string().min(3).max(300), launch: z.boolean().default(false) }),
    handler: async (ctx, { params, body }) => {
      const p = await programFor(ctx, params.programId!);
      const d = await draftCampaign(body.prompt, p.currency, undefined, p.workspaceId);
      if (!d) throw new ApiError(422, "unparseable", "Couldn't turn that sentence into a campaign");
      return createCampaign(p.id, d, ctx.actor, body.launch ? "active" : "draft");
    },
  },
  {
    method: "GET",
    path: "/programs/{programId}/autopilot",
    scope: "read",
    tag: "Growth",
    summary: "Autopilot suggestions and recent actions",
    handler: async (ctx, { params }) => {
      await programFor(ctx, params.programId!);
      return {
        data: await db()
          .select()
          .from(agentAction)
          .where(eq(agentAction.programId, params.programId!))
          .orderBy(desc(agentAction.createdAt))
          .limit(50),
      };
    },
  },
  {
    method: "POST",
    path: "/programs/{programId}/autopilot/{actionId}/apply",
    scope: "partners:write",
    tag: "Growth",
    summary: "Apply an Autopilot suggestion (payout suggestions only prepare a batch)",
    handler: async (ctx, { params }) => {
      await programFor(ctx, params.programId!);
      return applyAction(params.programId!, params.actionId!, ctx.actor);
    },
  },
  {
    method: "POST",
    path: "/programs/{programId}/ask",
    scope: "read",
    tag: "Growth",
    summary: "Ask a plain-language question about the program",
    body: z.object({ question: z.string().min(2).max(500) }),
    handler: async (ctx, { params, body }) => {
      const p = await programFor(ctx, params.programId!);
      return ask(p.id, body.question, {
        base: `/app/${p.id}`,
        currency: p.currency,
        workspaceId: p.workspaceId,
      });
    },
  },
];

export function match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const keys: string[] = [];
    const pattern = r.path.replace(/\{(\w+)\}/g, (_, k: string) => {
      keys.push(k);
      return "([^/]+)";
    });
    const re = new RegExp(`^${pattern}$`);
    const m = path.match(re);
    if (m)
      return { route: r, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])) };
  }
  return null;
}

export function openApi(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const q = r.query
      ? Object.entries(
          (z.toJSONSchema(r.query) as { properties?: Record<string, unknown> }).properties ?? {},
        ).map(([name, schema]) => ({ name, in: "query", required: false, schema }))
      : [];
    paths[r.path] ??= {};
    paths[r.path]![r.method.toLowerCase()] = {
      summary: r.summary,
      tags: [r.tag],
      security: [{ bearer: [] }],
      "x-scope": r.scope,
      parameters: [...params, ...q],
      ...(r.body
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: z.toJSONSchema(r.body) } },
            },
          }
        : {}),
      responses: {
        "200": { description: "OK" },
        "400": { description: "Invalid request (validation errors list the fields in issues)" },
        "401": { description: "Missing or invalid API key" },
        "403": { description: "Key lacks the required scope" },
        "404": { description: "Not found" },
        "429": { description: "Rate limited" },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "OpenPromoter API",
      version: "1.0.0",
      description:
        "Partner programs, tracking, commissions and payouts. Payouts prepared by API always need a person to approve them in the dashboard.",
      license: { name: "AGPL-3.0", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "API key from Settings > API & webhooks" },
      },
    },
    paths,
  };
}
