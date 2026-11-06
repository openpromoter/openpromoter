import { click, link, partner, program, referral } from "@openpromoter/db";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { hashIp } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { parseLanding, pickClick } from "./attribution";
import { db } from "./db";
import { isBotUserAgent } from "./fraud";
import { afterNewReferral } from "./ingest";
import { clientIp, limit } from "./ratelimit";

export interface ClickInput {
  programId: string;
  /** partner code (?via=code) or a short link key */
  code?: string | null;
  linkKey?: string | null;
  visitorId?: string | null;
  landingUrl?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  country?: string | null;
  subId?: string | null;
}

export type ClickResult = {
  clickId: string;
  visitorId: string;
  partnerCode: string;
  destination?: string;
  cookieDays: number;
  attributionModel: string;
} | null;

type ProgramRef = { id: string } | { slug: string } | { idOrSlug: string };

/**
 * One round trip: the program plus the partner behind a code or short-link key. Program fields come back
 * even when the partner is unknown, so redirects can still send the visitor to the founder's site.
 */
async function resolveClick(ref: ProgramRef, input: { code?: string | null; linkKey?: string | null }) {
  const where =
    "id" in ref
      ? eq(program.id, ref.id)
      : "slug" in ref
        ? eq(program.slug, ref.slug)
        : or(eq(program.slug, ref.idOrSlug), eq(program.id, ref.idOrSlug));
  const partnerOn = input.linkKey
    ? eq(partner.id, link.partnerId)
    : and(
        eq(partner.programId, program.id),
        input.code ? sql`lower(${partner.code}) = lower(${input.code})` : sql`false`,
      );
  const [row] = await db()
    .select({
      programId: program.id,
      websiteUrl: program.websiteUrl,
      referralParam: program.referralParam,
      cookieDays: program.cookieDays,
      attributionModel: program.attributionModel,
      partnerId: partner.id,
      partnerCode: partner.code,
      partnerStatus: partner.status,
      linkId: link.id,
      linkPartnerId: link.partnerId,
      destination: link.destination,
      linkSubId: link.subId,
    })
    .from(program)
    .leftJoin(link, and(eq(link.programId, program.id), eq(link.key, input.linkKey ?? "")))
    .leftJoin(partner, partnerOn)
    .where(where)
    .limit(1);
  return row ?? null;
}

type Resolved = NonNullable<Awaited<ReturnType<typeof resolveClick>>>;

/** Builds the click row and the result; null when the partner is unknown or can't earn. */
function prepareClick(r: Resolved, input: ClickInput) {
  if (!r.partnerId || r.partnerStatus !== "approved") return null;
  const landing = parseLanding(input.landingUrl, r.referralParam);
  const visitorId = input.visitorId?.startsWith("vis_") ? input.visitorId.slice(0, 40) : createId("vis");
  const id = createId("clk");
  const row: typeof click.$inferInsert = {
    id,
    programId: r.programId,
    partnerId: r.partnerId,
    linkId: r.linkId ?? null,
    visitorId,
    ipHash: hashIp(input.ip),
    userAgent: input.userAgent?.slice(0, 400) ?? null,
    referrer: input.referrer?.slice(0, 500) ?? null,
    landingUrl: input.landingUrl?.slice(0, 1000) ?? null,
    country: input.country?.slice(0, 2) ?? null,
    subId: (input.subId ?? r.linkSubId ?? landing.subId)?.slice(0, 64) ?? null,
    utm: Object.keys(landing.utm).length ? landing.utm : null,
    isBot: isBotUserAgent(input.userAgent),
  };
  const result: NonNullable<ClickResult> = {
    clickId: id,
    visitorId,
    partnerCode: r.partnerCode!,
    destination: r.destination ?? undefined,
    cookieDays: r.cookieDays,
    attributionModel: r.attributionModel,
  };
  return { row, result };
}

const insertClick = (row: typeof click.$inferInsert) =>
  db()
    .insert(click)
    .values(row)
    .catch((err: Error) => console.error(`[click] not recorded: ${err.message}`));

/**
 * Records a click. Returns null for unknown codes or partners that can't earn.
 * With `defer` (Next's `after`), the insert runs after the response is sent; the click id is known up front.
 */
export async function recordClick(
  input: ClickInput & { programRef?: ProgramRef },
  defer?: (task: () => Promise<unknown>) => void,
): Promise<ClickResult> {
  const r = await resolveClick(input.programRef ?? { id: input.programId }, input);
  const prepared = r ? prepareClick(r, input) : null;
  if (!prepared) return null;
  if (defer) defer(() => insertClick(prepared.row));
  else await db().insert(click).values(prepared.row);
  return prepared.result;
}

const httpUrl = (u: string | null | undefined) => {
  try {
    const url = new URL(u ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
};

/**
 * Server-side click for short links and /r/<program>/<code>: one lookup (in parallel with the shared rate
 * limit), then a 302 to the founder's site; the click row is written after the response is sent.
 * The destination is always the program's site or a link that was checked against it when created.
 */
export async function redirectClick(
  req: Request,
  slug: string,
  opts: { code?: string; linkKey?: string },
  defer: (task: () => Promise<unknown>) => void,
) {
  const ip = clientIp(req);
  const [allowed, r] = await Promise.all([limit(`r:${ip}`, 120, 60_000), resolveClick({ slug }, opts)]);
  if (!r) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const input: ClickInput = {
    programId: r.programId,
    code: opts.code,
    linkKey: opts.linkKey,
    landingUrl: req.url,
    referrer: req.headers.get("referer"),
    userAgent: req.headers.get("user-agent"),
    ip,
    country: req.headers.get("cf-ipcountry"),
    subId: url.searchParams.get("sub")?.slice(0, 64),
  };
  const prepared = allowed.ok ? prepareClick(r, input) : null;
  if (prepared) defer(() => insertClick(prepared.row));
  const site = httpUrl(r.websiteUrl);
  const dest = (prepared && httpUrl(prepared.result.destination)) || site;
  if (!dest) return new Response("This program has no valid website URL", { status: 404 });
  for (const [k, v] of url.searchParams) if (k.startsWith("utm_")) dest.searchParams.set(k, v);
  if (prepared) {
    const c = prepared.result;
    dest.searchParams.set("op_click", c.clickId);
    dest.searchParams.set("op_visitor", c.visitorId);
    dest.searchParams.set(r.referralParam, c.partnerCode);
    dest.searchParams.set("op_days", String(c.cookieDays));
    if (c.attributionModel === "first_click") dest.searchParams.set("op_model", "first_click");
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: dest.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer-when-downgrade",
    },
  });
}

export interface LeadInput {
  programId: string;
  email: string;
  name?: string | null;
  clickId?: string | null;
  visitorId?: string | null;
  partnerCode?: string | null;
  externalCustomerId?: string | null;
  ip?: string | null;
}

/** Signup tracking before payment. Idempotent on (program, email). */
export async function recordLead(input: LeadInput) {
  const [prog] = await db().select().from(program).where(eq(program.id, input.programId));
  if (!prog) return null;
  const email = input.email.trim().toLowerCase();

  const [existing] = await db()
    .select()
    .from(referral)
    .where(and(eq(referral.programId, prog.id), sql`lower(${referral.email}) = ${email}`));
  if (existing) return existing;

  let partnerId: string | null = null;
  let clickId: string | null = null;
  let visitorId = input.visitorId ?? null;
  if (input.clickId) {
    const [c] = await db()
      .select()
      .from(click)
      .where(and(eq(click.id, input.clickId), eq(click.programId, prog.id)));
    if (c) ({ partnerId, id: clickId, visitorId } = c);
  }
  if (!partnerId && visitorId) {
    const clicks = await db()
      .select()
      .from(click)
      .where(and(eq(click.programId, prog.id), eq(click.visitorId, visitorId)))
      .orderBy(desc(click.createdAt))
      .limit(50);
    const chosen = pickClick(clicks, prog.attributionModel, new Date(), prog.cookieDays);
    if (chosen) ({ partnerId, id: clickId } = chosen);
  }
  if (!partnerId && input.partnerCode) {
    const [p] = await db()
      .select()
      .from(partner)
      .where(and(eq(partner.programId, prog.id), sql`lower(${partner.code}) = lower(${input.partnerCode})`));
    partnerId = p?.id ?? null;
  }
  if (!partnerId) return null;

  const [p] = await db().select().from(partner).where(eq(partner.id, partnerId));
  // like clicks: only an approved partner can be credited
  if (p?.status !== "approved") return null;
  return db().transaction(async (tx) => {
    const [r] = await tx
      .insert(referral)
      .values({
        id: createId("ref"),
        programId: prog.id,
        partnerId,
        clickId,
        visitorId,
        email,
        name: input.name ?? null,
        externalCustomerId: input.externalCustomerId ?? null,
        via: clickId ? "link" : "api",
        status: "lead",
        ipHash: hashIp(input.ip),
      })
      .onConflictDoNothing()
      .returning();
    if (r) await afterNewReferral(tx, prog, p, r);
    return r ?? null;
  });
}
