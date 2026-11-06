import { createDb, type schema } from "@openpromoter/db";
import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type AppDb = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as unknown as { __opDb?: AppDb };

/** Lazily connects; tests call setDb() with a PGlite instance. */
export function db(): AppDb {
  if (!g.__opDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // per process: replicas × DATABASE_POOL_MAX must stay under Postgres max_connections (default 100)
    g.__opDb = createDb(url, { max: Number(process.env.DATABASE_POOL_MAX) || 10 }) as unknown as AppDb;
  }
  return g.__opDb;
}

export function setDb(instance: AppDb) {
  g.__opDb = instance;
}

export type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/** Raw SQL rows; postgres.js returns an array, PGlite `{ rows }`. */
export async function query<T>(q: SQL): Promise<T[]> {
  const res = (await db().execute(q)) as unknown;
  return (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[];
}
