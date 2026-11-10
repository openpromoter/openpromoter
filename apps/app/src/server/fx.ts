import { commission, kvStore, program, referral } from "@openpromoter/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { minorFactor } from "@/lib/money";
import { type AppDb, db, type Tx } from "./db";

/**
 * Exchange rates for the founder's reports. A sale paid in another currency keeps its own currency on the
 * commission (that is what the partner earns and is paid); `commission.fx_rate` converts it into the
 * program's currency for revenue, totals, campaign milestones and tier promotion.
 *
 * Source order: the provider's own merchant-currency figure (Paddle payout totals, Lemon Squeezy USD
 * totals), then the European Central Bank's daily reference rates, kept in kv under `fx:ecb`.
 */

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const KEY = "fx:ecb";

export interface EcbRates {
  date: string;
  /** units of each currency per 1 EUR, lowercase codes, eur = 1 */
  rates: Record<string, number>;
}

/** Parses the ECB daily XML: <Cube time='2026-11-09'><Cube currency='USD' rate='1.1193'/>… */
export function parseEcb(xml: string): EcbRates | null {
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const rates: Record<string, number> = { eur: 1 };
  for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) {
    const r = Number(m[2]);
    if (r > 0) rates[m[1]!.toLowerCase()] = r;
  }
  return date && Object.keys(rates).length > 10 ? { date, rates } : null;
}

export async function ecbRates(d: AppDb | Tx = db()): Promise<EcbRates | null> {
  const [row] = await d.select().from(kvStore).where(eq(kvStore.key, KEY));
  return (row?.value as unknown as EcbRates) ?? null;
}

/**
 * Multiplier from minor units of `from` to minor units of `to` (1050 EUR cents → USD cents), or null when
 * a currency is not in the table. 1 when they are the same currency.
 */
export function minorRate(from: string, to: string, t: EcbRates | null): number | null {
  const f = from.toLowerCase();
  const o = to.toLowerCase();
  if (f === o) return 1;
  const rf = t?.rates[f];
  const ro = t?.rates[o];
  if (!rf || !ro) return null;
  return ((ro / rf) * minorFactor(o)) / minorFactor(f);
}

/** The rate for one sale: the provider's figure in the program's currency first, then ECB. */
export function saleRate(
  ev: { amount: number; currency: string; base?: { currency: string; amount: number } | null },
  programCurrency: string,
  t: EcbRates | null,
): number | null {
  if (ev.currency.toLowerCase() === programCurrency.toLowerCase()) return 1;
  if (ev.base && ev.amount > 0 && ev.base.amount > 0) {
    if (ev.base.currency.toLowerCase() === programCurrency.toLowerCase()) return ev.base.amount / ev.amount;
    // the provider settled in a third currency (say USD for a GBP program): go on from there with ECB
    const onward = minorRate(ev.base.currency, programCurrency, t);
    if (onward != null) return (ev.base.amount / ev.amount) * onward;
  }
  return minorRate(ev.currency, programCurrency, t);
}

/** Sums amounts kept in several currencies into one (USD for plan limits); unknown rates count 1:1. */
export function sumIn(rows: { currency: string; n: number }[], to: string, t: EcbRates | null): number {
  return Math.round(rows.reduce((s, r) => s + Number(r.n) * (minorRate(r.currency, to, t) ?? 1), 0));
}

/** SQL: this row's sale and commission in the program's currency. A row with no rate yet counts 1:1. */
export const baseSale = sql<number>`round(${commission.saleAmount} * coalesce(${commission.fxRate}, 1))`;
export const baseAmount = sql<number>`round(${commission.amount} * coalesce(${commission.fxRate}, 1))`;

/** Gives every commission that still has no rate one from the stored ECB table. Returns rows updated. */
export async function fillMissingRates(t?: EcbRates | null): Promise<number> {
  const table = t === undefined ? await ecbRates() : t;
  const pairs = await db()
    .selectDistinct({ currency: commission.currency, programCurrency: program.currency })
    .from(commission)
    .innerJoin(program, eq(program.id, commission.programId))
    .where(isNull(commission.fxRate));
  let n = 0;
  for (const p of pairs) {
    const rate = minorRate(p.currency, p.programCurrency, table);
    if (rate == null) continue;
    const progs = db()
      .select({ id: program.id })
      .from(program)
      .where(eq(program.currency, p.programCurrency));
    const rows = await db()
      .update(commission)
      .set({ fxRate: rate })
      .where(
        and(
          isNull(commission.fxRate),
          eq(commission.currency, p.currency),
          inArray(commission.programId, progs),
        ),
      )
      .returning({ id: commission.id });
    n += rows.length;
  }
  return n;
}

/**
 * The program's currency changed: rates now point at the new currency. Rows already in it get 1, the rest
 * are filled from ECB; customer revenue and MRR (kept in the program's currency) are converted once.
 */
export async function rebaseProgram(programId: string, from: string, to: string) {
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (f === t) return;
  const table = await ecbRates();
  await db().transaction(async (tx) => {
    await tx
      .update(commission)
      .set({ fxRate: 1 })
      .where(and(eq(commission.programId, programId), eq(commission.currency, t)));
    await tx
      .update(commission)
      .set({ fxRate: null })
      .where(and(eq(commission.programId, programId), ne(commission.currency, t)));
    const rate = minorRate(f, t, table);
    // ponytail: with no ECB table yet the stored revenue keeps its old numbers; it is a one-time change
    if (rate != null)
      await tx
        .update(referral)
        .set({
          revenue: sql`round(${referral.revenue} * ${rate}::float8)`,
          mrr: sql`round(${referral.mrr} * ${rate}::float8)`,
        })
        .where(eq(referral.programId, programId));
  });
  await fillMissingRates(table);
}

/** Fetches the ECB table (weekdays around 16:00 CET), stores it and fills rows that were waiting for it. */
export async function refreshRates(fetcher: typeof fetch = fetch): Promise<EcbRates | null> {
  const res = await fetcher(ECB_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ECB rates: HTTP ${res.status}`);
  const t = parseEcb(await res.text());
  if (!t) throw new Error("ECB rates: could not read the file");
  await storeRates(t);
  await fillMissingRates(t);
  return t;
}

/** Stores a table directly (tests, and self-hosters who load rates without internet access). */
export async function storeRates(t: EcbRates) {
  await db()
    .insert(kvStore)
    .values({ key: KEY, value: t as unknown as Record<string, unknown> })
    .onConflictDoUpdate({ target: kvStore.key, set: { value: t as unknown as Record<string, unknown> } });
}
