// Read-only SELECT helper for the e2e specs: node e2e/sql.mjs "select ..." prints the rows as JSON.
// Uses DATABASE_URL, or the one in apps/app/.env.local.
import fs from "node:fs";
import postgres from "postgres";

const q = process.argv[2] ?? "";
if (!/^\s*select/i.test(q)) throw new Error("read-only: SELECT statements only");
let url = process.env.DATABASE_URL;
if (!url) {
  const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  url = env.match(/^DATABASE_URL=(.*)$/m)?.[1];
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
console.log(JSON.stringify(await sql.unsafe(q), null, 1));
await sql.end();
