/** Container entrypoint: migrate, seed the demo (first boot only), then start Next.js. */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { seed } from "./seed";

const url = process.env.DATABASE_URL;
const publicUrl = !/localhost|127\.0\.0\.1/.test(process.env.APP_URL ?? "");
for (const k of ["BETTER_AUTH_SECRET", "ENCRYPTION_KEY"]) {
  if (publicUrl && (!process.env[k] || process.env[k]!.startsWith("change-me"))) {
    throw new Error(
      `${k} still has the placeholder value. Set a random 32+ character secret before exposing OpenPromoter on ${process.env.APP_URL}.`,
    );
  }
}
if (!url) throw new Error("DATABASE_URL is required");

for (let i = 0; i < 30; i++) {
  try {
    const c = postgres(url, { max: 1, onnotice: () => {} });
    // one replica migrates at a time; the others wait on the advisory lock, then find nothing to do
    await c`select pg_advisory_lock(727001)`;
    try {
      await migrate(drizzle(c), { migrationsFolder: process.env.MIGRATIONS_DIR ?? "/app/drizzle" });
    } finally {
      await c`select pg_advisory_unlock(727001)`;
      await c.end();
    }
    break;
  } catch (err) {
    if (i === 29) throw err;
    console.log("waiting for database…");
    await new Promise((r) => setTimeout(r, 2000));
  }
}
console.log("migrations applied");
if (process.env.SEED_DEMO === "true") await seed({ reset: false });
// @ts-expect-error built by next (standalone output)
await import("../server.js");
