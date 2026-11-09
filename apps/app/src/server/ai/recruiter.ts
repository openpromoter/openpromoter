import type Anthropic from "@anthropic-ai/sdk";
import { billingCustomer, partner, program, prospect } from "@openpromoter/db";
import { and, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@/lib/id";
import { formatMoney } from "@/lib/money";
import { type Actor, audit } from "../audit";
import { db } from "../db";
import { sendNotice } from "../email";
import { env } from "../env";
import { programUrl } from "../ref-link";
import {
  aiAllowed,
  aiJson,
  aiProvider,
  anthropicClient,
  anthropicModel,
  recordAiSpend,
  usageMicros,
} from "./provider";

type Program = typeof program.$inferSelect;
type Prospect = typeof prospect.$inferSelect;

const DAY = 86_400_000;

/** Score paying customers: long tenure + high lifetime value + still subscribed = likely advocate. */
export function scoreCustomer(
  c: { lifetimeValue: number; activeSubscription: boolean; customerSince: Date | null },
  now = new Date(),
) {
  const months = c.customerSince ? (now.getTime() - c.customerSince.getTime()) / (30 * DAY) : 0;
  const tenure = Math.min(40, months * 4);
  const value = Math.min(40, Math.log10(Math.max(1, c.lifetimeValue / 100)) * 13);
  return Math.round(tenure + value + (c.activeSubscription ? 20 : 0));
}

export function inviteTemplate(prog: Program, who: { name: string; source: string; reason: string }) {
  const first = who.name.split(/\s+/)[0] || "there";
  const rate =
    prog.commissionType === "percent"
      ? `${prog.commissionValue / 100}%`
      : formatMoney(prog.commissionValue, prog.currency);
  const span =
    prog.commissionDuration === "lifetime"
      ? "for as long as they stay"
      : prog.commissionDuration === "months"
        ? `for ${prog.commissionMonths} months`
        : "on their first purchase";
  const subject =
    who.source === "customer"
      ? `${first}, want to earn from recommending ${prog.name}?`
      : `Partnership idea: ${prog.name} x you`;
  const body =
    who.source === "customer"
      ? `Hi ${first},\n\nYou've been with ${prog.name} for a while, and customers like you are the reason it grows. We just opened a partner program: you earn ${rate} of what every customer you refer pays, ${span}.\n\nIt takes a minute to join and you get your own link right away.\n\nThanks for being a customer,\nThe ${prog.name} team`
      : `Hi ${first},\n\n${who.reason}\n\nWe run ${prog.name} and think your audience would find it useful. Our partner program pays ${rate} of every payment from people you refer, ${span}. We'll also give you ready-made posts and copy.\n\nWould you like to try it?\n\nBest,\nThe ${prog.name} team`;
  return { subject, body };
}

/** Pull the happiest paying customers into the recruiter queue with drafted invites. */
export async function findCustomerProspects(prog: Program, limit = 25) {
  const existing = await db()
    .select({ email: partner.email })
    .from(partner)
    .where(eq(partner.programId, prog.id));
  const taken = new Set(existing.map((e) => e.email.toLowerCase()));
  const customers = await db()
    .select()
    .from(billingCustomer)
    .where(and(eq(billingCustomer.workspaceId, prog.workspaceId), isNotNull(billingCustomer.email)))
    .orderBy(desc(billingCustomer.lifetimeValue))
    .limit(500);
  const ranked = customers
    .filter((c) => c.email && !taken.has(c.email.toLowerCase()))
    .map((c) => ({ c, score: scoreCustomer(c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  let added = 0;
  for (const { c, score } of ranked) {
    const months = c.customerSince
      ? Math.max(1, Math.round((Date.now() - c.customerSince.getTime()) / (30 * DAY)))
      : null;
    const reason = `Paying customer${months ? ` for ${months} months` : ""} with ${formatMoney(c.lifetimeValue, c.currency)} lifetime value${c.activeSubscription ? " and still subscribed" : ""}.`;
    const name = c.name ?? c.email!.split("@")[0]!;
    const t = inviteTemplate(prog, { name, source: "customer", reason });
    const row = await db()
      .insert(prospect)
      .values({
        id: createId("pro"),
        programId: prog.id,
        source: "customer",
        name,
        email: c.email!.toLowerCase(),
        reason,
        score,
        inviteSubject: t.subject,
        inviteBody: t.body,
      })
      .onConflictDoNothing()
      .returning();
    added += row.length;
  }
  return added;
}

const creatorSchema = z.object({
  creators: z.array(
    z.object({ name: z.string(), url: z.string(), email: z.string(), reason: z.string(), score: z.number() }),
  ),
});

/**
 * Finds creators and newsletters in the founder's niche with Claude's web search tool.
 * Only real, cited pages are kept. Without an Anthropic key this returns 0 and the UI
 * offers manual add and CSV import instead.
 */
export async function findCreatorProspects(prog: Program, niche: string, limit = 10) {
  if (aiProvider() !== "anthropic" || !env.ANTHROPIC_API_KEY) return 0;
  if (!(await aiAllowed(prog.workspaceId))) return 0;
  const client = anthropicClient();
  // Measured 2026-11-06: Haiku with the basic search found 5 fitting creators for $0.02-0.03 a run. Sonnet with
  // dynamic filtering cost $0.09-0.13 and often returned none. Searches are capped at 3.
  const model = anthropicModel("fast");
  let text = "";
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [
        {
          role: "user",
          content: `Find ${limit} real creators, newsletters, YouTube channels or blogs that write for the audience of this product and could be affiliate partners. Product: ${prog.name} (${prog.websiteUrl}). Niche: ${niche}. For each give name, their main URL, a public contact email if one is listed on their site (else empty string), one sentence on why they fit, and a 0-100 fit score. Only include people you found on real pages. Prefer people who publish for this audience regularly. Keep the final answer to a plain list with no preamble.`,
        },
      ],
    });
    const micros = usageMicros(res.model ?? model, res.usage);
    await recordAiSpend(prog.workspaceId, micros);
    if (process.env.AI_LOG)
      console.info(
        `[ai] ${res.model} web search in=${res.usage.input_tokens} out=${res.usage.output_tokens} searches=${res.usage.server_tool_use?.web_search_requests ?? 0} cost=$${(micros / 1e6).toFixed(5)}`,
      );
    text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  } catch (err) {
    console.warn(`[recruiter] web search failed: ${(err as Error).message}`);
    return 0;
  }
  const parsed = await aiJson(creatorSchema, {
    system:
      "Extract the list of creators from the research notes. Keep only entries with a real http(s) URL. Write each reason as one sentence of 20 words or fewer about who their audience is and why it matches the product. Leave out notes about what the research did or didn't check.",
    prompt: text,
    workspaceId: prog.workspaceId,
  });
  // the email index can't catch creators with no public email: skip a site the program already has
  const site = (u: string) =>
    u
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/+$/, "");
  const known = new Set(
    (await db().select({ url: prospect.url }).from(prospect).where(eq(prospect.programId, prog.id)))
      .map((p) => (p.url ? site(p.url) : ""))
      .filter(Boolean),
  );
  let added = 0;
  for (const c of parsed?.creators.slice(0, limit) ?? []) {
    if (!/^https?:\/\//.test(c.url) || known.has(site(c.url))) continue;
    known.add(site(c.url));
    const t = inviteTemplate(prog, { name: c.name, source: "creator", reason: c.reason });
    const row = await db()
      .insert(prospect)
      .values({
        id: createId("pro"),
        programId: prog.id,
        source: "creator",
        name: c.name,
        email: c.email || null,
        url: c.url,
        reason: c.reason,
        score: Math.round(c.score),
        inviteSubject: t.subject,
        inviteBody: t.body,
      })
      .onConflictDoNothing()
      .returning();
    added += row.length;
  }
  return added;
}

/** Personalise drafted invites with AI (keeps the template when AI is off). */
export async function personalise(prog: Program, p: Prospect) {
  const out = await aiJson(z.object({ subject: z.string(), body: z.string() }), {
    system:
      "Rewrite this partner invitation so it is personal, short (under 120 words), honest and specific to the recipient. Keep the commission terms exactly. Plain text, no emojis.",
    workspaceId: prog.workspaceId,
    prompt: `Recipient: ${p.name} (${p.source}). Why them: ${p.reason}. Product: ${prog.name} ${prog.websiteUrl}.\nDraft subject: ${p.inviteSubject}\nDraft body:\n${p.inviteBody}`,
  });
  if (out)
    await db()
      .update(prospect)
      .set({ inviteSubject: out.subject, inviteBody: out.body })
      .where(eq(prospect.id, p.id));
  return !!out;
}

/** Sends approved invites. Human approval is the only way a prospect reaches "approved". */
export async function sendInvites(prog: Program, ids: string[], actor: Actor) {
  const rows = await db()
    .select()
    .from(prospect)
    .where(
      and(
        eq(prospect.programId, prog.id),
        inArray(prospect.id, ids),
        inArray(prospect.status, ["new", "approved"]),
      ),
    );
  let sent = 0;
  for (const p of rows) {
    if (!p.email) continue;
    const href = `${programUrl(prog, "/apply")}?invite=${p.id}&email=${encodeURIComponent(p.email)}`;
    await sendNotice(p.email, p.inviteSubject ?? `Join the ${prog.name} partner program`, {
      brandName: prog.name,
      brandColor: prog.brand.color,
      logoUrl: prog.brand.logoUrl,
      preview: p.inviteSubject ?? "",
      title: p.inviteSubject ?? `Join the ${prog.name} partner program`,
      paragraphs: (p.inviteBody ?? "").split(/\n{2,}/),
      cta: { label: "Join the program", href },
    });
    await db()
      .update(prospect)
      .set({ status: "sent", sentAt: new Date(), followUpAt: new Date(Date.now() + 5 * DAY) })
      .where(eq(prospect.id, p.id));
    sent++;
  }
  await audit(prog.workspaceId, actor, "recruiter.send", undefined, { count: sent });
  return sent;
}

/** One follow-up after 5 days for invites that did not convert. */
export async function sendFollowUps(now = new Date()) {
  const due = await db()
    .select({ p: prospect, prog: program })
    .from(prospect)
    .innerJoin(program, eq(program.id, prospect.programId))
    .where(and(eq(prospect.status, "sent"), lte(prospect.followUpAt, now)));
  for (const { p, prog } of due) {
    const [joined] = await db()
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.programId, prog.id), sql`lower(${partner.email}) = lower(${p.email ?? ""})`));
    if (joined) {
      await db().update(prospect).set({ status: "joined" }).where(eq(prospect.id, p.id));
      continue;
    }
    if (p.email) {
      await sendNotice(p.email, `Re: ${p.inviteSubject ?? prog.name}`, {
        brandName: prog.name,
        brandColor: prog.brand.color,
        preview: "Quick follow-up",
        title: "Quick follow-up",
        paragraphs: [
          `Hi ${p.name.split(/\s+/)[0]}, I'm following up in case you missed my last email. The ${prog.name} partner program is open and takes a minute to join.`,
        ],
        cta: {
          label: "Join the program",
          href: `${programUrl(prog, "/apply")}?invite=${p.id}&email=${encodeURIComponent(p.email)}`,
        },
      });
    }
    await db().update(prospect).set({ status: "followed_up", followUpAt: null }).where(eq(prospect.id, p.id));
  }
  return due.length;
}
