import { program } from "@openpromoter/db";
import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { CORS, preflight } from "@/lib/cors";
import { db } from "@/server/db";
import { clientIp, limit } from "@/server/ratelimit";
import { recordLead } from "@/server/tracking";

export const OPTIONS = preflight;

const body = z.object({
  program: z.string().max(60),
  email: z.email().max(200),
  name: z.string().max(120).nullish(),
  clickId: z.string().max(40).nullish(),
  visitorId: z.string().max(40).nullish(),
  code: z.string().max(64).nullish(),
});

/** Browser lead tracking from op.js. Server-side calls use POST /api/v1/leads with an API key. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await limit(`lead:${ip}`, 20, 60_000)).ok)
    return Response.json({ error: "Too many requests" }, { status: 429, headers: CORS });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400, headers: CORS });
  const v = parsed.data;
  const [p] = await db()
    .select({ id: program.id })
    .from(program)
    .where(or(eq(program.slug, v.program), eq(program.id, v.program)));
  if (!p) return Response.json({ error: "Unknown program" }, { status: 404, headers: CORS });
  const r = await recordLead({
    programId: p.id,
    email: v.email,
    name: v.name,
    clickId: v.clickId,
    visitorId: v.visitorId,
    partnerCode: v.code,
    ip,
  });
  return Response.json({ ok: !!r }, { headers: CORS });
}
