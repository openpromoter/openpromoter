import { program } from "@openpromoter/db";
import { eq, or } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { CORS, preflight } from "@/lib/cors";
import { db } from "@/server/db";
import { clientIp, limit } from "@/server/ratelimit";
import { recordClick } from "@/server/tracking";

export const OPTIONS = preflight;

const body = z.object({
  program: z.string().max(60),
  code: z.string().max(64),
  visitorId: z.string().max(40).nullish(),
  url: z.string().max(2000).nullish(),
  referrer: z.string().max(1000).nullish(),
  subId: z.string().max(64).nullish(),
});

/** op.js click: one lookup, the insert runs after the response (op.js only needs the ids). */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await limit(`click:${ip}`, 60, 60_000)).ok)
    return Response.json({ error: "Too many requests" }, { status: 429, headers: CORS });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400, headers: CORS });
  const v = parsed.data;
  const r = await recordClick(
    {
      programId: v.program,
      programRef: { idOrSlug: v.program },
      code: v.code,
      visitorId: v.visitorId,
      landingUrl: v.url,
      referrer: v.referrer,
      userAgent: req.headers.get("user-agent"),
      ip,
      country: req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country"),
      subId: v.subId,
    },
    after,
  );
  if (!r) {
    // only on the miss path: tell an unknown program apart from an unknown code
    const [p] = await db()
      .select({ id: program.id })
      .from(program)
      .where(or(eq(program.slug, v.program), eq(program.id, v.program)));
    if (!p) return Response.json({ error: "Unknown program" }, { status: 404, headers: CORS });
    return Response.json({ ok: false }, { status: 200, headers: CORS });
  }
  return Response.json(
    {
      ok: true,
      clickId: r.clickId,
      visitorId: r.visitorId,
      code: r.partnerCode,
      cookieDays: r.cookieDays,
      model: r.attributionModel,
    },
    { headers: CORS },
  );
}
