import { contentAsset, type program } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { sha256 } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { formatMoney } from "@/lib/money";
import { db } from "../db";
import { fetchSite, type SiteFacts } from "./brand";
import { aiJson } from "./provider";

type Program = typeof program.$inferSelect;
type Kind = "swipe" | "social" | "email" | "comparison" | "banner";

export const BANNER_SIZES = [
  { w: 300, h: 250, label: "Medium rectangle" },
  { w: 728, h: 90, label: "Leaderboard" },
  { w: 1200, h: 628, label: "Social card" },
  { w: 1080, h: 1080, label: "Square post" },
] as const;

export interface Asset {
  kind: Kind;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
}

/** Template kit, built from what we read on the founder's site. Used without AI and as the AI's starting point. */
export function templateKit(
  prog: Program,
  site: Pick<SiteFacts, "name" | "description" | "headline">,
): Asset[] {
  const name = prog.name;
  const what = site.description ?? site.headline ?? `${name} helps teams get more done.`;
  const link = "{{link}}";
  const offer = prog.doubleSided.enabled
    ? ` Use my link for ${prog.doubleSided.percentOff}% off your first ${prog.doubleSided.durationMonths} months.`
    : "";
  return [
    { kind: "swipe", title: "One-liner", body: `I've been using ${name}: ${what}${offer} ${link}` },
    {
      kind: "swipe",
      title: "Short recommendation",
      body: `If you're looking for a better way to handle this, try ${name}. ${what} It's the tool I recommend to anyone who asks.${offer}\n\n${link}`,
    },
    {
      kind: "social",
      title: "X / Threads post",
      body: `Tool I keep recommending: ${name}.\n\n${what}${offer}\n\n${link}`,
    },
    {
      kind: "social",
      title: "LinkedIn post",
      body: `A quick recommendation for anyone in my network.\n\nI started using ${name} recently. ${what}\n\nWhat I like: it does one job well and stays simple.${offer}\n\nTry it here: ${link}`,
    },
    {
      kind: "email",
      title: "Newsletter blurb",
      body: `**Tool of the week: ${name}**\n\n${what}${offer}\n\n[Try ${name}](${link})`,
    },
    {
      kind: "email",
      title: "Personal email",
      body: `Subject: You should look at ${name}\n\nHey,\n\nYou mentioned you were looking for something like this. I use ${name}: ${what}\n\n${offer ? `${offer.trim()}\n\n` : ""}${link}\n\nCheers`,
    },
    {
      kind: "comparison",
      title: "Why it's different",
      body: `Compared with the usual options, ${name} is quicker to set up and focused on doing one thing well: ${what} If you've tried the alternatives and found them heavy, it's worth a look. ${link}`,
    },
    ...BANNER_SIZES.map((s) => ({
      kind: "banner" as const,
      title: `${s.label} ${s.w}×${s.h}`,
      body: site.headline ?? name,
      meta: { width: s.w, height: s.h },
    })),
  ];
}

const aiSchema = z.object({
  assets: z.array(
    z.object({
      kind: z.enum(["swipe", "social", "email", "comparison"]),
      title: z.string(),
      body: z.string(),
    }),
  ),
});

/** (Re)generates the content kit. Keeps a hash of the site so the weekly job only refreshes on change. */
export async function generateContentKit(prog: Program, opts: { force?: boolean } = {}) {
  const site = await fetchSite(prog.websiteUrl);
  const hash = sha256(`${site.title}|${site.description}|${site.headline}|${site.text.slice(0, 2000)}`).slice(
    0,
    16,
  );
  const existing = await db().select().from(contentAsset).where(eq(contentAsset.programId, prog.id));
  if (
    !opts.force &&
    existing.length &&
    existing.every((e) => e.sourceHash === hash || e.generatedBy === "user")
  )
    return { refreshed: false, count: existing.length };

  const base = templateKit(prog, site);
  const rate =
    prog.commissionType === "percent"
      ? `${prog.commissionValue / 100}%`
      : formatMoney(prog.commissionValue, prog.currency);
  const ai = await aiJson(aiSchema, {
    system:
      "You write marketing material that affiliate partners copy and paste. Write in the partner's voice as a real user recommending the product: honest, specific and warm. Use only facts present in the product text. Build each piece around one concrete benefit from that text. If the text is short, write shorter pieces. Never mention what you don't know. No emojis except where natural on social. Every asset must contain the literal placeholder {{link}} exactly once.",
    prompt: `Product: ${prog.name}\nSite text: ${site.text.slice(0, 3000) || "(not available)"}\nDescription: ${site.description || prog.brand.description || "(not available)"}\nCustomer discount via partner link: ${prog.doubleSided.enabled ? `${prog.doubleSided.percentOff}% for ${prog.doubleSided.durationMonths} months` : "none"}\n(Partners earn ${rate}; never mention this to readers.)\nWrite 2 swipe copies, 3 social posts (X, LinkedIn, Reddit-style), 2 emails (newsletter blurb, personal email with Subject line), 1 comparison blurb.`,
    // measured 2026-11-06: Haiku at medium wrote factual copy that passed the writing rules for $0.002,
    // against $0.012 on Sonnet and $0.024 on Opus
    effort: "medium",
    tier: "fast",
    workspaceId: prog.workspaceId,
  });
  const textAssets = ai?.assets.filter((a) => a.body.includes("{{link}}")).length
    ? ai.assets.filter((a) => a.body.includes("{{link}}"))
    : base.filter((a) => a.kind !== "banner");
  const assets: Asset[] = [...textAssets, ...base.filter((a) => a.kind === "banner")];

  await db().transaction(async (tx) => {
    const keep = existing.filter((e) => e.generatedBy === "user");
    await tx.delete(contentAsset).where(eq(contentAsset.programId, prog.id));
    if (keep.length) await tx.insert(contentAsset).values(keep);
    await tx.insert(contentAsset).values(
      assets.map((a) => ({
        id: createId("cnt"),
        programId: prog.id,
        kind: a.kind,
        title: a.title,
        body: a.body,
        meta: a.meta ?? null,
        generatedBy: ai ? ("ai" as const) : ("template" as const),
        sourceHash: hash,
      })),
    );
  });
  return { refreshed: true, count: assets.length };
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (`${cur} ${w}`.trim().length > maxChars) {
      lines.push(cur.trim());
      cur = w;
      if (lines.length === maxLines) break;
    } else cur += ` ${w}`;
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  return lines;
}

/** Brand-coloured banner as SVG; partners download it or hot-link it. */
export function bannerSvg(opts: {
  width: number;
  height: number;
  name: string;
  headline: string;
  color: string;
  fg: string;
  cta?: string;
}) {
  const { width: w, height: h } = opts;
  const wide = w / h > 3;
  const fs = wide ? Math.round(h * 0.28) : Math.round(Math.min(w, h) * 0.085);
  const lines = wrap(
    opts.headline,
    wide ? Math.floor(w / (fs * 0.6)) - 14 : Math.floor((w * 0.84) / (fs * 0.55)),
    wide ? 1 : 3,
  );
  const pad = Math.round(Math.min(w, h) * 0.08);
  const cta = opts.cta ?? `Try ${opts.name}`;
  const ctaFs = Math.round(fs * 0.62);
  const ctaW = Math.round(cta.length * ctaFs * 0.6 + ctaFs * 2);
  const ctaH = Math.round(ctaFs * 2.2);
  const text = lines
    .map(
      (l, i) =>
        `<text x="${pad}" y="${wide ? h / 2 + fs * 0.35 : pad + fs * 1.6 + i * fs * 1.2}" font-size="${fs}" font-weight="700" fill="${opts.fg}">${esc(l)}</text>`,
    )
    .join("");
  const ctaX = wide ? w - pad - ctaW : pad;
  const ctaY = wide ? (h - ctaH) / 2 : h - pad - ctaH;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif">
<rect width="${w}" height="${h}" fill="${opts.color}"/>
<circle cx="${w * 0.92}" cy="${h * 0.1}" r="${Math.max(w, h) * 0.35}" fill="${opts.fg}" opacity="0.07"/>
${wide ? "" : `<text x="${pad}" y="${pad + fs * 0.4}" font-size="${Math.round(fs * 0.5)}" font-weight="600" fill="${opts.fg}" opacity="0.8">${esc(opts.name)}</text>`}
${text}
<rect x="${ctaX}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="${Math.round(ctaH * 0.25)}" fill="${opts.fg}"/>
<text x="${ctaX + ctaW / 2}" y="${ctaY + ctaH / 2 + ctaFs * 0.35}" text-anchor="middle" font-size="${ctaFs}" font-weight="600" fill="${opts.color}">${esc(cta)}</text>
</svg>`;
}
