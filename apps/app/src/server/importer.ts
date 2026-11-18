import { commission, link, partner, partnerGroup, program, promoCode, type ReferralStatus, referral } from "@openpromoter/db";
import { and, eq, sql } from "drizzle-orm";
import { createCode, createId, slugify } from "@/lib/id";
import { toMinor } from "@/lib/money";
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

/** A referral code as the old tool wrote it: letters, digits, dash, underscore and dot, at most 64 (attribution reads 64). */
export function cleanCode(raw: string): string {
  return raw.trim().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
}

/** The partner a migration row points at: by email first, then by code. */
export async function findPartnerByRef(programId: string, ref: { email?: string; code?: string }) {
  if (ref.email) {
    const [p] = await db()
      .select()
      .from(partner)
      .where(and(eq(partner.programId, programId), sql`lower(${partner.email}) = lower(${ref.email})`));
    if (p) return p;
  }
  if (ref.code) {
    const [p] = await db()
      .select()
      .from(partner)
      .where(and(eq(partner.programId, programId), sql`lower(${partner.code}) = lower(${ref.code})`));
    if (p) return p;
  }
  return null;
}

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
  const conflicts: string[] = [];
  const get = (r: string[], k: string) => (cols[k] != null ? (r[cols[k]!] ?? "").trim() : "");
  for (const r of rows.slice(1, 5001)) {
    const email = get(r, "email").toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      skipped++;
      continue;
    }
    const name =
      get(r, "name") || [get(r, "first"), get(r, "last")].filter(Boolean).join(" ") || email.split("@")[0]!;
    // keep the partner's old code exactly so links already in the wild keep attributing (op.js reads via/fpr/ref/gspk)
    const own = cleanCode(get(r, "code"));
    let code = own || slugify(name).replace(/-/g, "").slice(0, 12) || createCode();
    const [taken] = await db()
      .select({ id: partner.id, email: partner.email })
      .from(partner)
      .where(and(eq(partner.programId, programId), sql`lower(${partner.code}) = lower(${code})`));
    if (taken && own) {
      // renaming would break every link this partner already shared, so leave it to the founder
      if (taken.email.toLowerCase() !== email) conflicts.push(`${email}: code ${own} belongs to another partner`);
      skipped++;
      continue;
    }
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
  return { created, skipped, columns: Object.keys(cols), conflicts };
}

/** Header names in referral and customer exports from the same tools, mapped to ours. */
const REFERRAL_ALIASES: Record<string, string[]> = {
  partnerEmail: ["partner_email", "affiliate_email", "promoter_email"],
  partnerCode: [
    "referral_code",
    "ref_id",
    "token",
    "via",
    "affiliate_code",
    "promoter_ref_id",
    "partner_key",
  ],
  customerId: [
    "stripe_customer_id",
    "customer_id",
    "uid",
    "external_id",
    "paddle_customer_id",
    "customer_key",
  ],
  email: ["email", "customer_email", "lead_email"],
  name: ["name", "customer_name"],
  status: ["status", "state"],
  convertedAt: ["converted_at", "conversion_date", "became_customer_at", "first_payment_at", "created_at"],
};

/** Finds each alias group's column in a header row. */
function mapWith(aliases: Record<string, string[]>, header: string[]): Record<string, number> {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const out: Record<string, number> = {};
  for (const [key, names] of Object.entries(aliases)) {
    const i = norm.findIndex((h) => names.includes(h));
    if (i >= 0) out[key] = i;
  }
  return out;
}

function referralStatus(raw: string, hasCustomer: boolean): ReferralStatus {
  const s = raw.toLowerCase();
  if (/^(canceled|cancelled|churned)$/.test(s)) return "canceled";
  if (/^(trialing|trial)$/.test(s)) return "trialing";
  return hasCustomer ? "active" : "lead";
}

/** One line per row the import could not place, capped so a bad file does not flood the page. */
const note = (list: string[], line: string) => {
  if (list.length < 50) list.push(line);
};

/**
 * Customers a partner brought in before the switch. A row with the billing customer id makes renewals
 * pay that partner (ingest looks the customer up first); a row with only an email is matched on the
 * customer's next payment. No lead commission, bounty or email fires, since these are old referrals.
 */
export async function importReferrals(programId: string, csv: string, actor: Actor) {
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  if (!prog) throw new Error("Program not found");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("The file needs a header row and at least one customer");
  const cols = mapWith(REFERRAL_ALIASES, rows[0]!);
  if (cols.partnerEmail == null && cols.partnerCode == null)
    throw new Error("No partner column found (looked for partner_email, affiliate_email, referral_code…)");
  if (cols.customerId == null && cols.email == null)
    throw new Error("No customer column found (looked for stripe_customer_id, customer_id, customer_email…)");
  const get = (r: string[], k: string) => (cols[k] != null ? (r[cols[k]!] ?? "").trim() : "");
  let created = 0;
  let skipped = 0;
  const missing: string[] = [];
  for (const [i, r] of rows.slice(1, 5001).entries()) {
    const ref = { email: get(r, "partnerEmail").toLowerCase(), code: get(r, "partnerCode") };
    const customerId = get(r, "customerId").slice(0, 200);
    const email = get(r, "email").toLowerCase();
    if (!customerId && !/^\S+@\S+\.\S+$/.test(email)) {
      skipped++;
      continue;
    }
    const p = await findPartnerByRef(programId, ref);
    if (!p) {
      skipped++;
      note(missing, `row ${i + 2}: no partner ${ref.email || ref.code || "given"}`);
      continue;
    }
    if (!customerId) {
      // no billing id to make it unique, so the email is the key: a second run must not add it twice
      const [seen] = await db()
        .select({ id: referral.id })
        .from(referral)
        .where(and(eq(referral.programId, programId), sql`lower(${referral.email}) = ${email}`));
      if (seen) {
        skipped++;
        continue;
      }
    }
    const status = referralStatus(get(r, "status"), !!customerId);
    const when = new Date(get(r, "convertedAt"));
    const [row] = await db()
      .insert(referral)
      .values({
        id: createId("ref"),
        programId,
        partnerId: p.id,
        email: email || null,
        name: get(r, "name").slice(0, 120) || null,
        externalCustomerId: customerId || null,
        via: "manual",
        status,
        convertedAt:
          status === "lead" ? null : Number.isNaN(when.getTime()) || !get(r, "convertedAt") ? new Date() : when,
        canceledAt: status === "canceled" ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning({ id: referral.id });
    if (row) created++;
    else skipped++;
  }
  await audit(prog.workspaceId, actor, "referral.import", { type: "program", id: programId }, { created, skipped });
  return { created, skipped, columns: Object.keys(cols), missing };
}

/** "$1,234.50", "1234.5" or "1.234,50 €" → 1234.5 (major units); null when it is not a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[^0-9.,-]/g, "");
  // "1.234,50" and "12,5": a comma followed by one or two digits at the end is the decimal mark
  s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const BALANCE_ALIASES: Record<string, string[]> = {
  partnerEmail: ["email", "partner_email", "affiliate_email", "promoter_email"],
  partnerCode: REFERRAL_ALIASES.partnerCode!,
  unpaid: ["unpaid", "balance", "unpaid_balance", "amount_due", "pending_balance", "current_balance"],
  paid: ["paid", "total_paid", "paid_out", "lifetime_paid"],
};

/**
 * What each partner was owed and had been paid in the old tool, in the program's currency. Unpaid becomes
 * an approved adjustment that rides in the next payout; paid becomes a paid adjustment that only counts
 * toward the lifetime total. Fixed source keys make a second run of the same file a no-op.
 */
export async function importBalances(programId: string, csv: string, actor: Actor) {
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  if (!prog) throw new Error("Program not found");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("The file needs a header row and at least one partner");
  const cols = mapWith(BALANCE_ALIASES, rows[0]!);
  if (cols.partnerEmail == null && cols.partnerCode == null)
    throw new Error("No partner column found (looked for email, partner_email, referral_code…)");
  if (cols.unpaid == null && cols.paid == null)
    throw new Error("No amount column found (looked for unpaid, balance, total_paid…)");
  const get = (r: string[], k: string) => (cols[k] != null ? (r[cols[k]!] ?? "").trim() : "");
  let created = 0;
  let skipped = 0;
  const missing: string[] = [];
  for (const [i, r] of rows.slice(1, 5001).entries()) {
    const ref = { email: get(r, "partnerEmail").toLowerCase(), code: get(r, "partnerCode") };
    const unpaid = cols.unpaid != null ? parseAmount(get(r, "unpaid")) : 0;
    const paid = cols.paid != null ? parseAmount(get(r, "paid")) : 0;
    // a value we cannot read is skipped, never booked as zero
    if (unpaid == null || paid == null || unpaid < 0 || paid < 0) {
      skipped++;
      continue;
    }
    const p = await findPartnerByRef(programId, ref);
    if (!p) {
      skipped++;
      note(missing, `row ${i + 2}: no partner ${ref.email || ref.code || "given"}`);
      continue;
    }
    const lines = [
      { key: "unpaid", major: unpaid, status: "approved" as const, description: "Balance brought over from your previous tool" },
      { key: "paid", major: paid, status: "paid" as const, description: "Paid out in your previous tool" },
    ];
    let any = false;
    for (const l of lines) {
      const amount = toMinor(l.major, prog.currency);
      if (amount <= 0) continue;
      const [row] = await db()
        .insert(commission)
        .values({
          id: createId("com"),
          programId,
          workspaceId: prog.workspaceId,
          partnerId: p.id,
          kind: "adjustment",
          sourceKey: `import:${l.key}:${p.id}`,
          amount,
          currency: prog.currency,
          fxRate: 1,
          status: l.status,
          description: l.description,
        })
        .onConflictDoNothing()
        .returning({ id: commission.id });
      if (row) {
        created++;
        any = true;
      }
    }
    if (!any) skipped++;
  }
  await audit(prog.workspaceId, actor, "balance.import", { type: "program", id: programId }, { created, skipped });
  return { created, skipped, columns: Object.keys(cols), missing };
}
