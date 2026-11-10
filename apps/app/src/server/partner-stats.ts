import { commission } from "@openpromoter/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { baseAmount } from "./fx";

export async function timeseriesForPartner(partnerId: string, days: number) {
  const from = new Date(Date.now() - days * 86_400_000);
  const rows = await db()
    .select({
      d: sql<string>`to_char(date_trunc('day', ${commission.createdAt}), 'YYYY-MM-DD')`,
      n: sql<number>`coalesce(sum(${baseAmount}),0)::int`,
    })
    .from(commission)
    .where(
      and(
        eq(commission.partnerId, partnerId),
        gte(commission.createdAt, from),
        sql`${commission.status} <> 'reversed'`,
      ),
    )
    .groupBy(sql`1`);
  const map = new Map(rows.map((r) => [r.d, r.n]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(from.getTime() + (i + 1) * 86_400_000).toISOString().slice(0, 10);
    return { date: d, earned: map.get(d) ?? 0 };
  });
}
