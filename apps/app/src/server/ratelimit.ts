import { rateLimit as rateLimitTable } from "@openpromoter/db";
import { lt, sql } from "drizzle-orm";
import { sha256 } from "@/lib/crypto";
import { db, query } from "./db";

export interface RateResult {
  ok: boolean;
  remaining: number;
  /** epoch ms when the window resets */
  reset: number;
}

/** Fixed-window limiter. `hit` counts one request against `key` and says whether it is within `limit`. */
export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<RateResult>;
}

const buckets = new Map<string, { count: number; reset: number }>();

function memoryHit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  b.count++;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), reset: b.reset };
}

/** Per process. Correct for one instance; N replicas let N × limit through. */
export const memoryLimiter: RateLimiter = {
  hit: async (key, limit, windowMs) => memoryHit(key, limit, windowMs),
};

/**
 * Shared across replicas: one atomic upsert on an UNLOGGED table. Keys are hashed (they contain IPs).
 * Falls back to the in-memory limiter if the database call fails, so a limiter outage never blocks traffic.
 */
export const postgresLimiter: RateLimiter = {
  async hit(key, limit, windowMs) {
    try {
      const [row] = await query<{ count: number; reset_at: string | Date }>(sql`
        insert into ${rateLimitTable} as r (key, count, reset_at)
        values (${sha256(`${process.env.ENCRYPTION_KEY ?? "op"}:rl:${key}`)}, 1, now() + ${windowMs}::float8 * interval '1 millisecond')
        on conflict (key) do update set
          count = case when r.reset_at <= now() then 1 else r.count + 1 end,
          reset_at = case when r.reset_at <= now() then excluded.reset_at else r.reset_at end
        returning count, reset_at`);
      const count = Number(row?.count ?? 1);
      return {
        ok: count <= limit,
        remaining: Math.max(0, limit - count),
        reset: new Date(row?.reset_at ?? Date.now() + windowMs).getTime(),
      };
    } catch (err) {
      console.error(`[ratelimit] falling back to memory: ${(err as Error).message}`);
      return memoryHit(key, limit, windowMs);
    }
  },
};

/** RATE_LIMIT_STORE=memory keeps counters in the process (single instance); the default is Postgres. */
export const limiter = (): RateLimiter =>
  process.env.RATE_LIMIT_STORE === "memory" ? memoryLimiter : postgresLimiter;

/** Shared limit (see `limiter`). */
export const limit = (key: string, max: number, windowMs: number) => limiter().hit(key, max, windowMs);

/**
 * @deprecated synchronous and per process; use `await limit(...)`. Kept for callers that can't await yet.
 */
export function rateLimit(key: string, max: number, windowMs: number): RateResult {
  return memoryHit(key, max, windowMs);
}

/** Drops expired counters (scheduled). */
export async function pruneRateLimits() {
  await db()
    .delete(rateLimitTable)
    .where(lt(rateLimitTable.resetAt, new Date(Date.now() - 60_000)));
}

/**
 * Client IP for rate limits and fraud signals. With TRUSTED_IP_HEADER set (e.g. cf-connecting-ip behind
 * Cloudflare, fly-client-ip on Fly) only that header is read. Otherwise the right-most X-Forwarded-For entry,
 * the one written by the proxy in front of the app; left-most entries are whatever the client sent.
 */
export function clientIp(req: Request | { headers: Headers }): string | null {
  const h = req.headers;
  const trusted = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (trusted) return h.get(trusted)?.split(",")[0]?.trim() || null;
  const xff = h
    .get("x-forwarded-for")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return xff?.at(-1) ?? h.get("x-real-ip") ?? null;
}
