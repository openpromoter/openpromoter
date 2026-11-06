import { link, partner, partnerGroup, program, promoCode } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { createCode, createId, slugify } from "@/lib/id";
import { type Actor, audit } from "./audit";
import { db } from "./db";

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Header names used by Rewardful, FirstPromoter, Tolt and PartnerStack exports, mapped to ours. */
const ALIASES: Record<string, string[]> = {
  email: ["email", "partner_email", "affiliate_email", "promoter_email", "e-mail"],
  name: ["name", "full_name", "partner_name", "affiliate_name", "promoter_name"],
  first: ["first_name", "firstname", "first name"],
  last: ["last_name", "lastname", "last name"],
  code: [
    "code",
    "referral_code",
    "ref_id",
    "token",
    "link_token",
    "ref",
    "via",
    "partner_key",
    "gspk",
    "affiliate_code",
    "default_ref_id",
  ],
  coupon: ["coupon", "coupon_code", "promo_code", "promotion_code"],
  paypal: ["paypal_email", "paypal", "payout_email"],
  website: ["website", "url", "site"],
  country: ["country", "country_code"],
};

export function mapHeaders(header: string[]): Record<string, number> {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const out: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    const i = norm.findIndex((h) => names.map((n) => n.replace(/\s+/g, "_")).includes(h));
    if (i >= 0) out[key] = i;
  }
  return out;
}

export async function importPartners(programId: string, csv: string, actor: Actor) {
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  if (!prog) throw new Error("Program not found");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("The file needs a header row and at least one partner");
  const cols = mapHeaders(rows[0]!);
  if (cols.email == null)
    throw new Error("No email column found (looked for email, partner_email, affiliate_email…)");
  const [group] = await db()
    .select()
    .from(partnerGroup)
    .where(and(eq(partnerGroup.programId, programId), eq(partnerGroup.isDefault, true)));
  let created = 0;
  let skipped = 0;
  const get = (r: string[], k: string) => (cols[k] != null ? (r[cols[k]!] ?? "").trim() : "");
  for (const r of rows.slice(1, 5001)) {
    const email = get(r, "email").toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      skipped++;
      continue;
    }
    const name =
      get(r, "name") || [get(r, "first"), get(r, "last")].filter(Boolean).join(" ") || email.split("@")[0]!;
    // keep the partner's old code so links already in the wild keep attributing (op.js reads via/fpr/ref/gspk)
    let code =
      slugify(get(r, "code")).replace(/-/g, "") ||
      slugify(name).replace(/-/g, "").slice(0, 12) ||
      createCode();
    const [taken] = await db()
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.programId, programId), eq(partner.code, code)));
    if (taken) code = `${code}${createCode(3)}`;
    const [p] = await db()
      .insert(partner)
      .values({
        id: createId("prt"),
        programId,
        workspaceId: prog.workspaceId,
        email,
        name: name.slice(0, 120),
        code,
        status: "approved",
        approvedAt: new Date(),
        groupId: group?.id ?? null,
        source: "import",
        paypalEmail: get(r, "paypal") || null,
        payoutMethod: get(r, "paypal") ? "paypal" : null,
        website: get(r, "website") || null,
        country: get(r, "country").slice(0, 2).toUpperCase() || null,
      })
      .onConflictDoNothing()
      .returning();
    if (!p) {
      skipped++;
      continue;
    }
    created++;
    await db()
      .insert(link)
      .values({
        id: createId("lnk"),
        programId,
        partnerId: p.id,
        key: `${code}${createCode(2)}`,
        destination: prog.websiteUrl,
        label: "Default link",
      });
    const coupon = get(r, "coupon");
    if (coupon)
      await db()
        .insert(promoCode)
        .values({ id: createId("prm"), programId, partnerId: p.id, code: coupon.toUpperCase() })
        .onConflictDoNothing();
  }
  await audit(
    prog.workspaceId,
    actor,
    "partner.import",
    { type: "program", id: programId },
    { created, skipped },
  );
  return { created, skipped, columns: Object.keys(cols) };
}
