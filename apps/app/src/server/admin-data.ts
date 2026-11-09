import {
  account,
  auditLog,
  commission,
  emailLog,
  job,
  member,
  partner,
  program,
  session,
  user,
  webhookDelivery,
  webhookEndpoint,
  workspace,
} from "@openpromoter/db";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  like,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "./db";

/**
 * Queries behind the admin console's list pages. Each is filtered and paged in the database (one page of
 * rows and a count) through an index, so the pages cost the same with ten customers or ten thousand.
 */
const DAY = 86_400_000;
// correlated subqueries: drizzle writes a bare column name inside sql``, so the outer row is named in full
const U = sql.raw('"user"."id"');
const P = sql.raw('"partner"."id"');
const page = (p: number, size: number) => ({ limit: size, offset: (p - 1) * size });
/** A search term safe for LIKE: lower case, wildcards stripped. */
const term = (q: string) =>
  q
    .trim()
    .toLowerCase()
    .replace(/[%_\\]/g, "");

/** Every partner on the platform, for "a partner emailed me" questions. Email searches by prefix. */
export async function adminPartners(q: string, p: number, size = 50) {
  const t = term(q);
  const where: SQL | undefined = t
    ? t.includes("@")
      ? like(partner.email, `${t}%`)
      : or(like(partner.email, `${t}%`), ilike(partner.name, `${t}%`))
    : undefined;
  const earned = sql<number>`coalesce((select sum(${commission.amount}) from ${commission} where ${commission.partnerId} = ${P} and ${commission.test} = false),0)::bigint`;
  const [rows, [total]] = await Promise.all([
    db()
      .select({
        id: partner.id,
        name: partner.name,
        email: partner.email,
        status: partner.status,
        country: partner.country,
        joined: partner.createdAt,
        program: program.name,
        currency: program.currency,
        workspaceId: program.workspaceId,
        earned,
      })
      .from(partner)
      .innerJoin(program, eq(program.id, partner.programId))
      .where(where)
      .orderBy(desc(partner.createdAt))
      .$dynamic()
      .limit(page(p, size).limit)
      .offset(page(p, size).offset),
    db().select({ n: count() }).from(partner).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, earned: Number(r.earned) })), total: total?.n ?? 0 };
}

/** Every account: founders (members of a workspace) and partners (linked to a partner record). */
export async function adminUsers(q: string, p: number, size = 50) {
  const t = term(q);
  const where = t ? or(like(user.email, `${t}%`), ilike(user.name, `${t}%`)) : undefined;
  const [rows, [total]] = await Promise.all([
    db()
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        verified: user.emailVerified,
        twoFactor: user.twoFactorEnabled,
        createdAt: user.createdAt,
        methods: sql<string>`coalesce((select string_agg(distinct ${account.providerId}, ',') from ${account} where ${account.userId} = ${U}),'')`,
        lastActive: sql<Date | null>`(select max(${session.updatedAt}) from ${session} where ${session.userId} = ${U})`,
        workspaceId: sql<
          string | null
        >`(select ${member.workspaceId} from ${member} where ${member.userId} = ${U} limit 1)`,
        workspaces: sql<number>`(select count(*) from ${member} where ${member.userId} = ${U})::int`,
        partnerOf: sql<number>`(select count(*) from ${partner} where ${partner.userId} = ${U})::int`,
      })
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(size)
      .offset((p - 1) * size),
    db().select({ n: count() }).from(user).where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, lastActive: r.lastActive ? new Date(r.lastActive) : null })),
    total: total?.n ?? 0,
  };
}

/** Background jobs: waiting longer than they should, failed, or the latest finished. */
export async function adminJobs(tab: string, p: number, size = 50) {
  const now = Date.now();
  const where =
    tab === "failed"
      ? isNotNull(job.failedAt)
      : tab === "waiting"
        ? and(isNull(job.doneAt), isNull(job.failedAt))
        : isNotNull(job.doneAt);
  const order = tab === "failed" ? desc(job.failedAt) : tab === "waiting" ? job.runAt : desc(job.doneAt);
  const [rows, [total], [late], [failed24]] = await Promise.all([
    db()
      .select({
        id: job.id,
        name: job.name,
        runAt: job.runAt,
        doneAt: job.doneAt,
        failedAt: job.failedAt,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        error: job.lastError,
      })
      .from(job)
      .where(where)
      .orderBy(order)
      .limit(size)
      .offset((p - 1) * size),
    db().select({ n: count() }).from(job).where(where),
    db()
      .select({ n: count() })
      .from(job)
      .where(and(isNull(job.doneAt), isNull(job.failedAt), lt(job.runAt, new Date(now - 5 * 60_000)))),
    db()
      .select({ n: count() })
      .from(job)
      .where(gte(job.failedAt, new Date(now - DAY))),
  ]);
  return { rows, total: total?.n ?? 0, late: late?.n ?? 0, failed24: failed24?.n ?? 0 };
}

/** Partner webhook deliveries that failed in the last 7 days, with the founder they belong to. */
export async function adminWebhooks(p: number, size = 50) {
  const where = and(
    eq(webhookDelivery.status, "failed"),
    gte(webhookDelivery.createdAt, new Date(Date.now() - 7 * DAY)),
  );
  const [rows, [total]] = await Promise.all([
    db()
      .select({
        id: webhookDelivery.id,
        event: webhookDelivery.event,
        at: webhookDelivery.createdAt,
        attempts: webhookDelivery.attempts,
        responseStatus: webhookDelivery.responseStatus,
        error: webhookDelivery.lastError,
        url: webhookEndpoint.url,
        kind: webhookEndpoint.kind,
        workspaceId: workspace.id,
        workspace: workspace.name,
      })
      .from(webhookDelivery)
      .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
      .innerJoin(workspace, eq(workspace.id, webhookEndpoint.workspaceId))
      .where(where)
      .orderBy(desc(webhookDelivery.createdAt))
      .limit(size)
      .offset((p - 1) * size),
    db().select({ n: count() }).from(webhookDelivery).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}

/** What happened across every workspace, newest first; `action` narrows by prefix (plan., partner., ...). */
export async function adminActivity(action: string | null, p: number, size = 50) {
  const where = action ? like(auditLog.action, `${action.replace(/[%_\\]/g, "")}%`) : undefined;
  const [rows, [total]] = await Promise.all([
    db()
      .select({
        id: auditLog.id,
        at: auditLog.createdAt,
        action: auditLog.action,
        actorType: auditLog.actorType,
        data: auditLog.data,
        workspaceId: auditLog.workspaceId,
        workspace: workspace.name,
      })
      .from(auditLog)
      .leftJoin(workspace, eq(workspace.id, auditLog.workspaceId))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(size)
      .offset((p - 1) * size),
    db().select({ n: count() }).from(auditLog).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}

/** Email health for the sidebar and overview: problems in the last 7 days. */
export async function emailProblems() {
  const [r] = await db()
    .select({ n: count() })
    .from(emailLog)
    .where(
      and(
        gte(emailLog.createdAt, new Date(Date.now() - 7 * DAY)),
        or(eq(emailLog.status, "bounced"), eq(emailLog.status, "complained"), eq(emailLog.status, "failed")),
      ),
    );
  return r?.n ?? 0;
}
