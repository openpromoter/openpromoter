import { program } from "@openpromoter/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { CORS, preflight } from "@/lib/cors";
import { db } from "@/server/db";
import { clientIp, limit } from "@/server/ratelimit";

export const OPTIONS = preflight;

/** op.js calls this once per page load session so setup can confirm the install. */
export async function POST(req: Request) {
  if (!(await limit(`ping:${clientIp(req)}`, 30, 60_000)).ok)
    return new Response(null, { status: 429, headers: CORS });
  const { program: slug } = (await req.json().catch(() => ({}))) as { program?: string };
  if (typeof slug === "string" && slug.length <= 60) {
    await db()
      .update(program)
      .set({ installVerifiedAt: new Date() })
      .where(and(or(eq(program.slug, slug), eq(program.id, slug)), isNull(program.installVerifiedAt)));
  }
  return new Response(null, { status: 204, headers: CORS });
}
