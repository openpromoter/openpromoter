import { click, clickDaily, commission, link, partner, payout, referral } from "@openpromoter/db";
import { and, desc, eq, gte, inArray, isNull, lt, type SQL, sql } from "drizzle-orm";
import { cache } from "react";
import { db, query } from "./db";
import { baseAmount, baseSale } from "./fx";

export interface Range {
  from: Date;
  to: Date;
}

const DAY = 86_400_000;
/** Longest range any report will scan or zero-fill (10 years). */
const MAX_SPAN = 3660 * DAY;

/** Parses ?from/?to/?days. Invalid dates fall back to the default window; spans are capped. */
export function parseRange(
  params: { from?: string | null; to?: string | null; days?: string | null },
  now = new Date(),
): Range {
  const valid = (s?: string | null) => (s && !Number.isNaN(new Date(s).getTime()) ? new Date(s) : null);
  const to = valid(params.to) ?? now;
  const days = Math.min(3660, Math.max(1, Number(params.days ?? 30) || 30));
  let from = valid(params.from) ?? new Date(to.getTime() - days * DAY);
  if (to.getTime() - from.getTime() > MAX_SPAN) from = new Date(to.getTime() - MAX_SPAN);
  if (from > to) from = to;
  return { from, to };
}

export const previous = (r: Range): Range => {
  const span = r.to.getTime() - r.from.getTime();
  return { from: new Date(r.from.getTime() - span), to: r.from };
};

const num = (v: unknown) => Number(v ?? 0);
/** Dates inside raw sql`` must be strings for postgres.js. */
export const tsz = (d: Date | number) => sql`${new Date(d).toISOString()}::timestamptz`;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** UTC day of a timestamptz, as YYYY-MM-DD (independent of the session time zone). */
const utcDay = (col: unknown) => sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD')`;

/**
 * Splits a range for click counts: whole UTC days come from `click_daily` (kept exact by triggers),
 * the partial first and last day from raw `click` rows. Same totals as scanning `click`, a fraction of the rows.
 */
export function clickWindows(r: Range) {
  const from = r.from.getTime();
  const to = r.to.getTime();
  let d0 = Math.ceil(from / DAY) * DAY;
  let d1 = Math.floor(to / DAY) * DAY;
  if (d0 >= d1) d0 = d1 = to; // no whole day inside: raw rows only
  return {
    dayFrom: d0 < d1 ? iso(d0) : "1970-01-01",
    dayTo: d0 < d1 ? iso(d1) : "1970-01-01",
    edges: [
      [from, d0],
      [d1, to],
    ] as const,
  };
}

/** Raw click rows of the edge windows, as one UNION ALL branch per edge so each is an index range scan. */
const edgeClicks = (r: Range, cols: SQL, owner: SQL, extra?: SQL) =>
  sql.join(
    clickWindows(r).edges.map(
      ([a, b]) =>
        sql`select ${cols} from ${click} where ${owner} and ${click.createdAt} >= ${tsz(a)} and ${click.createdAt} < ${tsz(b)}${extra ? sql` and ${extra}` : sql``}`,
    ),
    sql` union all `,
  );

async function clickTotals(programId: string, r: Range) {
  const w = clickWindows(r);
  const [row] = await query<{ n: number; b: number; partners: number }>(sql`
    select coalesce(sum(n),0)::int as n, coalesce(sum(b),0)::int as b,
      (count(*) filter (where n + b > 0))::int as partners
    from (
      select partner_id, sum(n) as n, sum(b) as b from (
        select ${clickDaily.partnerId} as partner_id, ${clickDaily.clicks} as n, ${clickDaily.bots} as b from ${clickDaily}
        where ${clickDaily.programId} = ${programId} and ${clickDaily.day} >= ${w.dayFrom}::date and ${clickDaily.day} < ${w.dayTo}::date
        union all
        ${edgeClicks(r, sql`${click.partnerId}, (not ${click.isBot})::int, ${click.isBot}::int`, sql`${click.programId} = ${programId}`)}
      ) x group by partner_id
    ) y`);
  return { clicks: num(row?.n), bots: num(row?.b), activePartners: num(row?.partners) };
}

/** Balances don't depend on the range; cached per request so the current and previous period share them. */
const programBalances = cache(async (programId: string) => {
  const [mrr, owed] = await Promise.all([
    db()
      .select({
        mrr: sql<number>`coalesce(sum(${referral.mrr}),0)::bigint`,
        active: sql<number>`count(*)::int`,
      })
      .from(referral)
      .where(and(eq(referral.programId, programId), inArray(referral.status, ["active", "trialing"]))),
    db()
      .select({
        approved: sql<number>`coalesce(sum(${baseAmount}) filter (where ${commission.status}='approved' and ${commission.payoutId} is null),0)::bigint`,
        pending: sql<number>`coalesce(sum(${baseAmount}) filter (where ${commission.status}='pending'),0)::bigint`,
        held: sql<number>`coalesce(sum(${baseAmount}) filter (where ${commission.status}='held'),0)::bigint`,
      })
      .from(commission)
      // the WHERE only narrows to the statuses the sums read; lets Postgres skip paid/reversed history
      .where(
        and(eq(commission.programId, programId), inArray(commission.status, ["approved", "pending", "held"])),
      ),
  ]);
  return { mrr: mrr[0], owed: owed[0] };
});

/** Per-request memo (React cache): the analytics page and funnel() ask for the same overview. */
const overviewCached = cache(async (programId: string, fromMs: number, toMs: number) => {
  const r = { from: new Date(fromMs), to: new Date(toMs) };
  const [clicks, [refs], [conv], [money], bal, [paid]] = await Promise.all([
    clickTotals(programId, r),
    db()
      .select({
        leads: sql<number>`count(*)::int`,
        customers: sql<number>`count(*) filter (where ${referral.convertedAt} is not null)::int`,
      })
      .from(referral)
      .where(
        and(eq(referral.programId, programId), gte(referral.createdAt, r.from), lt(referral.createdAt, r.to)),
      ),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(referral)
      .where(
        and(
          eq(referral.programId, programId),
          gte(referral.convertedAt, r.from),
          lt(referral.convertedAt, r.to),
        ),
      ),
    db()
      .select({
        revenue: sql<number>`coalesce(sum(${baseSale}),0)::bigint`,
        commissions: sql<number>`coalesce(sum(${baseAmount}) filter (where ${commission.status} <> 'reversed'),0)::bigint`,
      })
      .from(commission)
      .where(
        and(
          eq(commission.programId, programId),
          gte(commission.createdAt, r.from),
          lt(commission.createdAt, r.to),
        ),
      ),
    programBalances(programId),
    db()
      .select({ n: sql<number>`coalesce(sum(${payout.amount}),0)::bigint` })
      .from(payout)
      .where(
        and(
          eq(payout.programId, programId),
          eq(payout.status, "paid"),
          gte(payout.paidAt, r.from),
          lt(payout.paidAt, r.to),
        ),
      ),
  ]);

  const c = clicks.clicks;
  return {
    clicks: c,
    leads: num(refs?.leads),
    customers: num(conv?.n),
    revenue: num(money?.revenue),
    commissions: num(money?.commissions),
    mrr: num(bal.mrr?.mrr),
    activeCustomers: num(bal.mrr?.active),
    owed: num(bal.owed?.approved),
    pending: num(bal.owed?.pending),
    held: num(bal.owed?.held),
    paid: num(paid?.n),
    activePartners: clicks.activePartners,
    conversionRate: c > 0 ? num(conv?.n) / c : 0,
    epc: c > 0 ? num(money?.commissions) / c : 0,
  };
});

export function overview(programId: string, r: Range) {
  return overviewCached(programId, r.from.getTime(), r.to.getTime());
}

export type Overview = Awaited<ReturnType<typeof overview>>;

export function delta(cur: number, prev: number) {
  if (prev === 0) return cur === 0 ? 0 : 1;
  return (cur - prev) / Math.abs(prev);
}

/** Daily buckets (UTC) for charts, zero-filled. */
export async function timeseries(programId: string, r: Range) {
  if (r.to.getTime() - r.from.getTime() > MAX_SPAN)
    r = { from: new Date(r.to.getTime() - MAX_SPAN), to: r.to };
  const w = clickWindows(r);
  const [clicks, refs, custs, money] = await Promise.all([
    query<{ d: string; n: number }>(sql`
      select d, sum(n)::int as n from (
        select to_char(${clickDaily.day}, 'YYYY-MM-DD') as d, ${clickDaily.clicks} as n from ${clickDaily}
        where ${clickDaily.programId} = ${programId} and ${clickDaily.day} >= ${w.dayFrom}::date and ${clickDaily.day} < ${w.dayTo}::date
        union all
        ${edgeClicks(r, sql`${utcDay(click.createdAt)}, 1`, sql`${click.programId} = ${programId}`, sql`not ${click.isBot}`)}
      ) x group by d`),
    db()
      .select({ d: utcDay(referral.createdAt), n: sql<number>`count(*)::int` })
      .from(referral)
      .where(
        and(eq(referral.programId, programId), gte(referral.createdAt, r.from), lt(referral.createdAt, r.to)),
      )
      .groupBy(sql`1`),
    db()
      .select({ d: utcDay(referral.convertedAt), n: sql<number>`count(*)::int` })
      .from(referral)
      .where(
        and(
          eq(referral.programId, programId),
          gte(referral.convertedAt, r.from),
          lt(referral.convertedAt, r.to),
        ),
      )
      .groupBy(sql`1`),
    db()
      .select({
        d: utcDay(commission.createdAt),
        revenue: sql<number>`coalesce(sum(${baseSale}),0)::bigint`,
        commissions: sql<number>`coalesce(sum(${baseAmount}),0)::bigint`,
      })
      .from(commission)
      .where(
        and(
          eq(commission.programId, programId),
          gte(commission.createdAt, r.from),
          lt(commission.createdAt, r.to),
        ),
      )
      .groupBy(sql`1`),
  ]);
  const map = <T extends { d: string }>(rows: T[]) => new Map(rows.map((x) => [x.d, x]));
  const [mc, mr, mu, mm] = [map(clicks), map(refs), map(custs), map(money)];
  const out: {
    date: string;
    clicks: number;
    leads: number;
    customers: number;
    revenue: number;
    commissions: number;
  }[] = [];
  const start = new Date(Date.UTC(r.from.getUTCFullYear(), r.from.getUTCMonth(), r.from.getUTCDate()));
  for (let t = start.getTime(); t < r.to.getTime(); t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push({
      date: d,
      clicks: num(mc.get(d)?.n),
      leads: num(mr.get(d)?.n),
      customers: num(mu.get(d)?.n),
      revenue: num(mm.get(d)?.revenue),
      commissions: num(mm.get(d)?.commissions),
    });
  }
  return out;
}

/**
 * Ranks by revenue then commissions in the range. The ranking reads one grouped scan of the range's commissions;
 * the per-partner columns below are only computed for the `limit` rows returned.
 */
export async function topPartners(programId: string, r: Range, limit = 10) {
  const w = clickWindows(r);
  const me = sql.raw('"partner"."id"');
  const c = db()
    .select({
      partnerId: commission.partnerId,
      revenue: sql<number>`sum(${baseSale})`.as("revenue"),
      commissions: sql<number>`sum(${baseAmount}) filter (where ${commission.status} <> 'reversed')`.as(
        "commissions",
      ),
    })
    .from(commission)
    .where(
      and(
        eq(commission.programId, programId),
        gte(commission.createdAt, r.from),
        lt(commission.createdAt, r.to),
      ),
    )
    .groupBy(commission.partnerId)
    .as("c");
  const edgeCount = sql.join(
    w.edges.map(
      ([a, b]) =>
        sql`(select count(*) from ${click} where ${click.partnerId} = ${me} and ${click.isBot} = false and ${click.createdAt} >= ${tsz(a)} and ${click.createdAt} < ${tsz(b)})`,
    ),
    sql` + `,
  );
  const rows = await db()
    .select({
      id: partner.id,
      name: partner.name,
      email: partner.email,
      status: partner.status,
      revenue: sql<number>`coalesce(${c.revenue},0)::bigint`,
      commissions: sql<number>`coalesce(${c.commissions},0)::bigint`,
      clicks: sql<number>`((select coalesce(sum(${clickDaily.clicks}),0) from ${clickDaily} where ${clickDaily.partnerId} = ${me} and ${clickDaily.day} >= ${w.dayFrom}::date and ${clickDaily.day} < ${w.dayTo}::date) + ${edgeCount})::int`,
      customers: sql<number>`(select count(*) from ${referral} where ${referral.partnerId} = ${me} and ${referral.convertedAt} >= ${tsz(r.from)} and ${referral.convertedAt} < ${tsz(r.to)})::int`,
      lifetimeRevenue: sql<number>`coalesce((select sum(${referral.revenue}) from ${referral} where ${referral.partnerId} = ${me}),0)::bigint`,
      lifetimeCustomers: sql<number>`(select count(*) from ${referral} where ${referral.partnerId} = ${me} and ${referral.convertedAt} is not null)::int`,
    })
    .from(partner)
    .leftJoin(c, eq(c.partnerId, partner.id))
    .where(eq(partner.programId, programId))
    .orderBy(desc(sql`coalesce(${c.revenue},0)`), desc(sql`coalesce(${c.commissions},0)`))
    .limit(limit);
  return rows.map((x) => ({
    ...x,
    revenue: num(x.revenue),
    commissions: num(x.commissions),
    clicks: num(x.clicks),
    customers: num(x.customers),
    lifetimeRevenue: num(x.lifetimeRevenue),
    lifetimeCustomers: num(x.lifetimeCustomers),
    epc: x.clicks > 0 ? num(x.commissions) / num(x.clicks) : 0,
    conversionRate: x.clicks > 0 ? num(x.customers) / num(x.clicks) : 0,
    ltv: x.lifetimeCustomers > 0 ? num(x.lifetimeRevenue) / num(x.lifetimeCustomers) : 0,
  }));
}

export async function funnel(programId: string, r: Range) {
  const o = await overview(programId, r);
  const [trials] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(referral)
    .where(
      and(
        eq(referral.programId, programId),
        gte(referral.createdAt, r.from),
        lt(referral.createdAt, r.to),
        sql`(${referral.status} = 'trialing' or ${referral.convertedAt} is not null)`,
      ),
    );
  return [
    { step: "Clicks", value: o.clicks },
    { step: "Signups", value: o.leads },
    { step: "Trials", value: num(trials?.n) },
    { step: "Customers", value: o.customers },
  ];
}

/** Monthly cohorts by first payment: how many customers and how much revenue each cohort kept. */
export async function cohorts(programId: string, months = 6) {
  const rows = await db()
    .select({
      cohort: sql<string>`to_char(date_trunc('month', ${referral.convertedAt}), 'YYYY-MM')`,
      customers: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${referral.status} in ('active','trialing'))::int`,
      revenue: sql<number>`coalesce(sum(${referral.revenue}),0)::bigint`,
      avgInvoices: sql<number>`coalesce(avg(${referral.paidInvoices}),0)::float`,
    })
    .from(referral)
    .where(
      and(
        eq(referral.programId, programId),
        sql`${referral.convertedAt} >= now() - (${months} || ' months')::interval`,
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((x) => ({
    ...x,
    revenue: num(x.revenue),
    retention: x.customers ? x.active / x.customers : 0,
  }));
}

/**
 * Which links, sub-ids and traffic sources produce customers. Customers are counted from a per-click
 * aggregate of converted referrals, so a click with several referrals is still one click.
 */
export async function topSources(programId: string, r: Range, limit = 10) {
  const conv = db()
    .select({ clickId: referral.clickId, n: sql<number>`count(*)`.as("n") })
    .from(referral)
    .where(
      and(
        eq(referral.programId, programId),
        gte(referral.createdAt, r.from),
        sql`${referral.clickId} is not null and ${referral.convertedAt} is not null`,
      ),
    )
    .groupBy(referral.clickId)
    .as("conv");
  const [bySource, byLink] = await Promise.all([
    db()
      .select({
        source: sql<string>`coalesce(${click.utm}->>'utm_source', nullif(split_part(split_part(${click.referrer}, '://', 2), '/', 1), ''), 'direct')`,
        clicks: sql<number>`count(*)::int`,
        customers: sql<number>`coalesce(sum(${conv.n}),0)::int`,
      })
      .from(click)
      .leftJoin(conv, eq(conv.clickId, click.id))
      .where(
        and(
          eq(click.programId, programId),
          gte(click.createdAt, r.from),
          lt(click.createdAt, r.to),
          eq(click.isBot, false),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(desc(sql`3`), desc(sql`2`))
      .limit(limit),
    db()
      .select({
        key: link.key,
        label: link.label,
        destination: link.destination,
        partner: partner.name,
        clicks: sql<number>`count(${click.id})::int`,
        customers: sql<number>`coalesce(sum(${conv.n}),0)::int`,
      })
      .from(link)
      .innerJoin(partner, eq(partner.id, link.partnerId))
      .leftJoin(
        click,
        and(eq(click.linkId, link.id), gte(click.createdAt, r.from), lt(click.createdAt, r.to)),
      )
      .leftJoin(conv, eq(conv.clickId, click.id))
      .where(eq(link.programId, programId))
      .groupBy(link.id, link.key, link.label, link.destination, partner.name)
      .orderBy(desc(sql`6`), desc(sql`5`))
      .limit(limit),
  ]);
  return { bySource, byLink };
}

export async function idlePartners(programId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  return db()
    .select({ id: partner.id, name: partner.name, email: partner.email, lastActiveAt: partner.lastActiveAt })
    .from(partner)
    .where(
      and(
        eq(partner.programId, programId),
        eq(partner.status, "approved"),
        sql`not exists (select 1 from ${click} where ${click.partnerId} = ${sql.raw('"partner"."id"')} and ${click.createdAt} >= ${tsz(since)})`,
        sql`${partner.approvedAt} < ${tsz(since)}`,
      ),
    );
}

export async function partnersWithCustomers(programId: string, r: Range) {
  return db()
    .select({
      id: partner.id,
      name: partner.name,
      customers: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${referral.revenue}),0)::bigint`,
    })
    .from(referral)
    .innerJoin(partner, eq(partner.id, referral.partnerId))
    .where(
      and(
        eq(referral.programId, programId),
        gte(referral.convertedAt, r.from),
        lt(referral.convertedAt, r.to),
      ),
    )
    .groupBy(partner.id, partner.name)
    .orderBy(desc(sql`4`));
}

export async function pendingApplications(programId: string) {
  return db()
    .select()
    .from(partner)
    .where(and(eq(partner.programId, programId), eq(partner.status, "pending")))
    .orderBy(partner.createdAt);
}

export const unpaidFilter = (programId: string) =>
  and(eq(commission.programId, programId), eq(commission.status, "approved"), isNull(commission.payoutId));
