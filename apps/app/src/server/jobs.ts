import { job } from "@openpromoter/db";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { createId } from "@/lib/id";
import { type AppDb, db, type Tx } from "./db";

type Handler = (payload: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();

export function defineJob(name: string, handler: Handler) {
  handlers.set(name, handler);
}

export async function enqueue(
  name: string,
  payload: Record<string, unknown> = {},
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
  tx: AppDb | Tx = db(),
) {
  await tx
    .insert(job)
    .values({
      id: createId("job"),
      name,
      payload,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey,
      maxAttempts: opts.maxAttempts ?? 8,
    })
    .onConflictDoNothing();
}

/**
 * Claim and run up to `limit` due jobs. Safe to run from many processes (SKIP LOCKED): a job is held by one
 * worker at a time; a worker that dies leaves `locked_at`, and the job is reclaimed after 10 minutes.
 * Delivery is at least once, so handlers must be idempotent (they key writes on ids / unique constraints).
 * Failures retry with exponential backoff and jitter; the last failure moves the job to the dead letter
 * state (`failed_at`), where it stays for inspection.
 */
export async function runDueJobs(limit = 10): Promise<number> {
  const claimed = await db().execute<{
    id: string;
    name: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE job SET locked_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM job
      WHERE done_at IS NULL AND failed_at IS NULL AND run_at <= now() AND attempts < max_attempts
        AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
      ORDER BY run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id, name, payload, attempts, max_attempts`);
  const rows = Array.isArray(claimed) ? claimed : ((claimed as { rows?: unknown[] }).rows ?? []);
  for (const r of rows as {
    id: string;
    name: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
  }[]) {
    const h = handlers.get(r.name);
    try {
      if (!h) throw new Error(`No handler for job ${r.name}`);
      await h(r.payload);
      await db()
        .update(job)
        .set({ doneAt: new Date(), lockedAt: null, lastError: null })
        .where(eq(job.id, r.id));
    } catch (err) {
      const lastError = String(err instanceof Error ? err.message : err).slice(0, 1000);
      const dead = r.attempts >= r.max_attempts;
      // exponential backoff: 30s, 1m, 2m, 4m ... capped at 6h, ±20% jitter so retries don't arrive together
      const delay = Math.min(30_000 * 2 ** (r.attempts - 1), 6 * 3_600_000) * (0.8 + Math.random() * 0.4);
      if (dead) console.error(`[jobs] ${r.name} ${r.id} failed ${r.attempts} times, moved to dead letter`);
      await db()
        .update(job)
        .set({
          lockedAt: null,
          lastError,
          ...(dead ? { failedAt: new Date() } : { runAt: new Date(Date.now() + delay) }),
        })
        .where(eq(job.id, r.id));
    }
  }
  return rows.length;
}

export async function pendingJobs(name?: string) {
  return db()
    .select()
    .from(job)
    .where(
      and(
        isNull(job.doneAt),
        isNull(job.failedAt),
        lte(job.runAt, new Date()),
        name ? eq(job.name, name) : undefined,
      ),
    );
}

/**
 * Housekeeping: delete finished jobs after 7 days (in batches), dead-letter jobs whose worker died on the
 * last attempt, and drop dead letters after 30 days.
 */
export async function pruneJobs() {
  await db().execute(sql`
    UPDATE job SET failed_at = now(), last_error = coalesce(last_error, 'worker stopped during the last attempt')
    WHERE done_at IS NULL AND failed_at IS NULL AND attempts >= max_attempts
      AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')`);
  for (let i = 0; i < 100; i++) {
    const res = (await db().execute(sql`
      DELETE FROM job WHERE id IN (
        SELECT id FROM job WHERE (done_at < now() - interval '7 days') OR (failed_at < now() - interval '30 days')
        LIMIT 5000)`)) as unknown as { count?: number; affectedRows?: number };
    if ((res.count ?? res.affectedRows ?? 0) < 5000) break;
  }
  // the email log keeps 30 days (support questions are about this month, not last year)
  await db().execute(sql`DELETE FROM email_log WHERE created_at < now() - interval '30 days'`);
}
