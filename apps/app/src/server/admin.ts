import {
  auditLog,
  billingConnection,
  clickDaily,
  commission,
  job,
  member,
  partner,
  program,
  session,
  user,
  webhookDelivery,
  workspace,
} from "@openpromoter/db";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  min,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { notFound } from "next/navigation";
import { planById } from "@/lib/plans";
import { currentUser } from "./context";
import { db } from "./db";
import { env } from "./env";
import { DEMO } from "@/lib/demo-accounts";
import { demoOn } from "./demo";

/**
 * The owner's read-only view of OpenPromoter Cloud. Only signed-in, email-verified users listed in
 * ADMIN_EMAILS get in; everyone else gets a 404, so the page doesn't show it exists.
 */
export const adminEmails = () =>
  (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export const isAdmin = (u: { email: string; emailVerified: boolean } | null | undefined) =>
  !!u?.emailVerified && adminEmails().includes(u.email.toLowerCase());

export async function requireAdmin() {
  const u = await currentUser();
  if (!isAdmin(u)) notFound();
  return u!;
}

const DAY = 86_400_000;
const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
const PAYING = ["active", "past_due", "trialing"];

/** Setup steps, the same four the founder's dashboard shows, plus the moments that prove it works. */
export const STEPS = [
  { key: "program", label: "Created a program" },
  { key: "billing", label: "Connected billing" },
  { key: "tracking", label: "Installed tracking" },
  { key: "partner", label: "Added a partner" },
  { key: "sale", label: "Tracked a sale" },
  { key: "paying", label: "Pays for a plan" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export type AdminWorkspace = Awaited<ReturnType<typeof adminWorkspaces>>[number];

/**
 * Every workspace (or just `only`) with what the owner acts on: plan and payment state, setup progress,
 * use and last activity. One grouped query per figure; with `only` each one is narrowed to that workspace
 * through its workspace index, so a workspace's page reads a few rows, not the whole database.
 */
export async function adminWorkspaces(only?: string) {
  const since30 = new Date(Date.now() - 30 * DAY);
  const day30 = since30.toISOString().slice(0, 10);
  const one = (col: Parameters<typeof eq>[0]) => (only ? eq(col, only) : undefined);
  const [wss, owners, active, progs, conns, partners, revenue, sales, clicks] = await Promise.all([
    db().select().from(workspace).where(one(workspace.id)).orderBy(desc(workspace.createdAt)),
    db()
      .select({ ws: member.workspaceId, email: user.email, name: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.role, "owner"), one(member.workspaceId))),
    db()
      .select({ ws: member.workspaceId, at: max(session.updatedAt) })
      .from(member)
      .innerJoin(session, eq(session.userId, member.userId))
      .where(one(member.workspaceId))
      .groupBy(member.workspaceId),
    db()
      .select({
        ws: program.workspaceId,
        n: count(),
        tracking: count(program.installVerifiedAt),
        domains: count(program.customDomainVerifiedAt),
      })
      .from(program)
      .where(one(program.workspaceId))
      .groupBy(program.workspaceId),
    db()
      .select({ ws: billingConnection.workspaceId, provider: billingConnection.provider })
      .from(billingConnection)
      .where(
        and(
          or(isNotNull(billingConnection.webhookSecretEnc), eq(billingConnection.mode, "oauth")),
          one(billingConnection.workspaceId),
        ),
      ),
    db()
      .select({ ws: partner.workspaceId, n: count() })
      .from(partner)
      .where(one(partner.workspaceId))
      .groupBy(partner.workspaceId),
    db()
      .select({
        ws: commission.workspaceId,
        n: sql<number>`coalesce(sum(${commission.saleAmount}),0)::bigint`,
      })
      .from(commission)
      .where(and(gte(commission.createdAt, monthStart()), one(commission.workspaceId)))
      .groupBy(commission.workspaceId),
    db()
      .select({ ws: commission.workspaceId, n: count(), first: min(commission.createdAt) })
      .from(commission)
      .where(and(eq(commission.test, false), ne(commission.amount, 0), one(commission.workspaceId)))
      .groupBy(commission.workspaceId),
    db()
      .select({ ws: program.workspaceId, n: sql<number>`coalesce(sum(${clickDaily.clicks}),0)::int` })
      .from(clickDaily)
      .innerJoin(program, eq(program.id, clickDaily.programId))
      .where(and(gte(clickDaily.day, day30), one(program.workspaceId)))
      .groupBy(program.workspaceId),
  ]);
  const by = <T extends { ws: string }>(rows: T[]) => new Map(rows.map((r) => [r.ws, r]));
  const own = by(owners);
  const act = by(active);
  const prg = by(progs);
  const prt = by(partners);
  const rev = by(revenue);
  const sal = by(sales);
  const clk = by(clicks);
  const providers = new Map<string, string[]>();
  for (const c of conns) providers.set(c.ws, [...(providers.get(c.ws) ?? []), c.provider]);
  const month = new Date().toISOString().slice(0, 7);
  // the public demo's sample company is not a customer: kept out of every business figure
  const demo = demoOn() ? new Set(wss.filter((w) => own.get(w.id)?.email === DEMO.email).map((w) => w.id)) : null;
  return wss.filter((w) => !demo?.has(w.id)).map((w) => {
    const plan = planById(w.plan);
    const paying = w.plan !== "free" && PAYING.includes(w.billingStatus ?? "");
    const usage = Number(rev.get(w.id)?.n ?? 0);
    const p = prg.get(w.id);
    const steps: Record<StepKey, boolean> = {
      program: (p?.n ?? 0) > 0,
      billing: providers.has(w.id),
      tracking: (p?.tracking ?? 0) > 0,
      partner: (prt.get(w.id)?.n ?? 0) > 0,
      sale: sal.has(w.id),
      paying,
    };
    const aiSpent = w.aiMonth === month ? w.aiSpentMicros : 0;
    const lastActive = act.get(w.id)?.at ?? null;
    const o = own.get(w.id);
    return {
      id: w.id,
      name: w.name,
      owner: o?.email ?? null,
      ownerName: o?.name ?? null,
      createdAt: w.createdAt,
      lastActive,
      plan,
      paying,
      mrr: paying ? plan.price : 0,
      status: w.billingStatus,
      cancelAt: w.billingCancelAt,
      region: w.billingRegion,
      customerId: w.billingCustomerId,
      subscriptionId: w.billingSubscriptionId,
      programs: p?.n ?? 0,
      domains: p?.domains ?? 0,
      providers: providers.get(w.id) ?? [],
      partners: prt.get(w.id)?.n ?? 0,
      clicks30: clk.get(w.id)?.n ?? 0,
      sales: sal.get(w.id)?.n ?? 0,
      usage,
      usageShare: usage / plan.revenueLimit,
      aiSpent,
      aiShare: aiSpent / plan.aiBudgetMicros,
      steps,
      done: STEPS.filter((s) => steps[s.key]).length,
    };
  });
}

/** Why a workspace needs the owner today, most urgent first. Empty when it is fine. */
export function attention(w: AdminWorkspace): { tone: "danger" | "warning" | "info"; text: string }[] {
  const out: { tone: "danger" | "warning" | "info"; text: string }[] = [];
  if (w.status === "past_due") out.push({ tone: "danger", text: `Payment failing on ${w.plan.name}` });
  if (w.cancelAt) out.push({ tone: "warning", text: `${w.plan.name} ends ${day(w.cancelAt)}` });
  if (w.usageShare > 1) out.push({ tone: "warning", text: `Over the ${w.plan.name} revenue limit` });
  else if (w.usageShare >= 0.8) out.push({ tone: "info", text: "Near the plan's revenue limit" });
  if (w.aiShare >= 1) out.push({ tone: "info", text: "AI allowance used up" });
  const age = Date.now() - w.createdAt.getTime();
  if (age > 3 * DAY && !w.steps.tracking) out.push({ tone: "info", text: "Stuck before tracking" });
  return out;
}

export { BILLING_TONE, billingLabel } from "./admin-labels";

export const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Cloud-wide figures for the top of the page. */
export async function adminPulse(rows: AdminWorkspace[]) {
  const now = Date.now();
  const since = (days: number) => rows.filter((w) => now - w.createdAt.getTime() < days * DAY).length;
  const signups = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * DAY).toISOString().slice(0, 10);
    return { day: d, signups: rows.filter((w) => w.createdAt.toISOString().slice(0, 10) === d).length };
  });
  const [[users], [waiting], failedJobs, [hooks]] = await Promise.all([
    db().select({ n: count() }).from(user),
    db()
      .select({ n: count() })
      .from(job)
      .where(and(isNull(job.doneAt), isNull(job.failedAt), lt(job.runAt, new Date(now - 5 * 60_000)))),
    db()
      .select({ name: job.name, error: job.lastError, at: job.failedAt })
      .from(job)
      .where(gte(job.failedAt, new Date(now - DAY)))
      .orderBy(desc(job.failedAt))
      .limit(5),
    db()
      .select({ n: count() })
      .from(webhookDelivery)
      .where(and(eq(webhookDelivery.status, "failed"), gte(webhookDelivery.createdAt, new Date(now - DAY)))),
  ]);
  const paying = rows.filter((w) => w.paying);
  return {
    mrr: paying.reduce((s, w) => s + w.mrr, 0),
    paying: paying.length,
    atRisk: paying.filter((w) => w.status === "past_due").reduce((s, w) => s + w.mrr, 0),
    workspaces: rows.length,
    users: users?.n ?? 0,
    new7: since(7),
    new30: since(30),
    active7: rows.filter((w) => w.lastActive && now - w.lastActive.getTime() < 7 * DAY).length,
    revenue: rows.reduce((s, w) => s + w.usage, 0),
    funnel: STEPS.map((s) => ({ step: s.label, count: rows.filter((w) => w.steps[s.key]).length })),
    signups,
    health: { waiting: waiting?.n ?? 0, failedJobs, failedHooks: hooks?.n ?? 0 },
  };
}

/** One workspace in full: members, programs and the latest audit events. */
export async function adminWorkspace(id: string) {
  const [w] = await adminWorkspaces(id);
  if (!w) notFound();
  const [members, programs, events] = await Promise.all([
    db()
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        verified: user.emailVerified,
        twoFactor: user.twoFactorEnabled,
        role: member.role,
        joined: member.createdAt,
        lastActive: max(session.updatedAt),
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .leftJoin(session, eq(session.userId, user.id))
      .where(eq(member.workspaceId, id))
      .groupBy(user.id, member.role, member.createdAt),
    db().select().from(program).where(eq(program.workspaceId, id)).orderBy(program.createdAt),
    db()
      .select()
      .from(auditLog)
      .where(eq(auditLog.workspaceId, id))
      .orderBy(desc(auditLog.createdAt))
      .limit(25),
  ]);
  const ids = programs.map((p) => p.id);
  const partnerCounts = ids.length
    ? await db()
        .select({ id: partner.programId, n: count() })
        .from(partner)
        .where(inArray(partner.programId, ids))
        .groupBy(partner.programId)
    : [];
  // the founder's partners, best first: who they are and what each one has brought in (live sales only)
  // the outer partner row named in full: inside sql`` drizzle would write a bare id (the commission's own)
  const money = sql`${commission.partnerId} = ${sql.raw('"partner"."id"')} and ${commission.test} = false`;
  const partners = await db()
    .select({
      id: partner.id,
      programId: partner.programId,
      name: partner.name,
      email: partner.email,
      status: partner.status,
      source: partner.source,
      country: partner.country,
      joined: partner.createdAt,
      revenue: sql<number>`coalesce((select sum(${commission.saleAmount}) from ${commission} where ${money} and ${commission.kind} = 'sale'),0)::bigint`,
      earned: sql<number>`coalesce((select sum(${commission.amount}) from ${commission} where ${money}),0)::bigint`,
    })
    .from(partner)
    .where(eq(partner.workspaceId, id))
    .orderBy(desc(sql`9`), desc(partner.createdAt)) // 9 = revenue
    .limit(200);
  return {
    w,
    members,
    programs: programs.map((p) => ({ ...p, partners: partnerCounts.find((c) => c.id === p.id)?.n ?? 0 })),
    partners: partners.map((pt) => ({
      ...pt,
      revenue: Number(pt.revenue),
      earned: Number(pt.earned),
      program: programs.find((p) => p.id === pt.programId)!,
    })),
    events,
  };
}

/**
 * The overview's full list, worked out at most every 5 minutes: totals over every workspace read whole
 * tables, and MRR doesn't need to be second-accurate. `fresh` (the page's refresh link) recomputes now.
 * ponytail: per-process memo; past ~50k workspaces keep these figures in a table a job refreshes.
 */
let memo: { at: Date; rows: AdminWorkspace[] } | null = null;
export async function adminWorkspacesCached(fresh = false) {
  if (!fresh && memo && Date.now() - memo.at.getTime() < 5 * 60_000) return memo;
  memo = { at: new Date(), rows: await adminWorkspaces() };
  return memo;
}
