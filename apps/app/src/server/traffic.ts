import { click, link, referral } from "@openpromoter/db";
import { and, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Where a program's (or one partner's) visitors come from: sources, countries, devices, landing pages,
 * sub-IDs and the latest visits. Humans only (bot clicks are kept for fraud checks, never shown here).
 * Read from raw clicks through the program and partner date indexes.
 * ponytail: scans the range's clicks per breakdown; capped at 90 days. Past ~5M clicks a quarter per
 * program, roll these up nightly like click_daily.
 */
export interface TrafficScope {
  programId: string;
  partnerId?: string | null;
  from: Date;
  to: Date;
}

const MAX = 90 * 86_400_000;
const host = sql`lower(regexp_replace(nullif(split_part(split_part(${click.referrer}, '://', 2), '/', 1), ''), '^www\\.', ''))`;
/** The visit's source: an utm_source tag wins, then the referring site, else Direct. */
const source = sql<string>`coalesce(nullif(${click.utm}->>'utm_source', ''), ${host}, 'Direct')`;
/** Device class from the browser's user agent. */
const device = sql<string>`case
  when ${click.userAgent} ~* '(ipad|tablet|kindle|silk)' then 'Tablet'
  when ${click.userAgent} ~* '(mobi|iphone|android)' then 'Mobile'
  when ${click.userAgent} is null or ${click.userAgent} = '' then 'Unknown'
  else 'Desktop' end`;
const landing = sql<string>`coalesce(nullif(regexp_replace(split_part(split_part(${click.landingUrl}, '://', 2), '?', 1), '^[^/]*', ''), ''), '/')`;

const start = (s: TrafficScope) =>
  s.to.getTime() - s.from.getTime() > MAX ? new Date(s.to.getTime() - MAX) : s.from;

function where(s: TrafficScope): SQL {
  const from = start(s);
  return and(
    eq(click.programId, s.programId),
    s.partnerId ? eq(click.partnerId, s.partnerId) : undefined,
    gte(click.createdAt, from),
    lt(click.createdAt, s.to),
    eq(click.isBot, false),
  )!;
}

/** Customers who came from a click: the referral the click started, once it paid. */
const converted = sql<number>`count(distinct ${referral.id}) filter (where ${referral.convertedAt} is not null)::int`;

export async function trafficReport(s: TrafficScope) {
  const w = where(s);
  const grouped = (key: SQL<string>, limit: number) =>
    db()
      .select({ key, clicks: sql<number>`count(distinct ${click.id})::int`, customers: converted })
      .from(click)
      .leftJoin(referral, eq(referral.clickId, click.id))
      .where(w)
      .groupBy(key)
      .orderBy(desc(sql`count(distinct ${click.id})`))
      .limit(limit);
  const dayKey = sql<string>`to_char(${click.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const [[totals], sources, countries, devices, pages, subIds, recent, perDay] = await Promise.all([
    db()
      .select({
        clicks: sql<number>`count(*)::int`,
        visitors: sql<number>`count(distinct ${click.visitorId})::int`,
      })
      .from(click)
      .where(w),
    grouped(source, 8),
    grouped(sql<string>`coalesce(${click.country}, '')`, 8),
    grouped(device, 4),
    grouped(landing, 6),
    grouped(sql<string>`coalesce(${click.subId}, '')`, 6),
    db()
      .select({
        at: click.createdAt,
        source,
        country: click.country,
        device,
        page: landing,
        key: link.key,
        customer: sql<boolean>`exists (select 1 from ${referral} r where r.click_id = ${sql.raw('"click"."id"')} and r.converted_at is not null)`,
      })
      .from(click)
      .leftJoin(link, eq(link.id, click.linkId))
      .where(w)
      .orderBy(desc(click.createdAt))
      .limit(15),
    db()
      .select({ day: dayKey, clicks: sql<number>`count(distinct ${click.id})::int`, customers: converted })
      .from(click)
      .leftJoin(referral, eq(referral.clickId, click.id))
      .where(w)
      .groupBy(dayKey),
  ]);
  // every day in the range, zero-filled, for the chart
  const got = new Map(perDay.map((d) => [d.day, d]));
  const days: { day: string; clicks: number; customers: number }[] = [];
  const first = Date.UTC(start(s).getUTCFullYear(), start(s).getUTCMonth(), start(s).getUTCDate());
  for (let t = first; t <= s.to.getTime(); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    days.push({ day: d, clicks: got.get(d)?.clicks ?? 0, customers: got.get(d)?.customers ?? 0 });
  }
  return {
    clicks: totals?.clicks ?? 0,
    days,
    visitors: totals?.visitors ?? 0,
    sources,
    countries: countries.filter((c) => c.key),
    devices,
    pages,
    subIds: subIds.filter((x) => x.key),
    recent,
  };
}

export type TrafficReport = Awaited<ReturnType<typeof trafficReport>>;
