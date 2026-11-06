import { PGlite } from "@electric-sql/pglite";
import { schema } from "@openpromoter/db";
import { migrationsFolder } from "@openpromoter/db/migrate";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll } from "vitest";
import { type AppDb, setDb } from "@/server/db";

process.env.ENCRYPTION_KEY ??= "test-encryption-key-test-encryption-key";
process.env.BETTER_AUTH_SECRET ??= "test-secret";

beforeAll(async () => {
  const client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder });
  setDb(d as unknown as AppDb);
});
