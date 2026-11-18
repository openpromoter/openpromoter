import { createHash } from "node:crypto";
import {
  commission,
  link,
  type PartnerStatus,
  partner,
  partnerGroup,
  program,
  promoCode,
  type ReferralStatus,
  referral,
} from "@openpromoter/db";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { createCode, createId, slugify } from "@/lib/id";
import { toMinor } from "@/lib/money";
import { type Actor, audit } from "./audit";
import { db, type Tx } from "./db";

/** Rows one file may hold. More is refused up front so a big file never half-imports. */
export const MAX_IMPORT_ROWS = 5000;
/** Rows per insert statement, well under Postgres's 65,535 parameter limit. */
const CHUNK = 500;
/** Skipped rows listed back to the founder; the rest are only counted. */
const MAX_NOTES = 50;
/** Characters kept per cell. No real email, code or amount is longer; it also bounds every regex below. */
const MAX_CELL = 1000;
/** The largest amount a commission row can hold (Postgres integer), in minor units. */
const MAX_MINOR = 2_147_483_647;

/**
 * RFC 4180 CSV parser (quotes, escaped quotes, CRLF). A leading byte order mark (Excel adds one) is dropped,
 * and each cell is cut at MAX_CELL characters.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        if (cur.length < MAX_CELL) cur += '"';
        i++;
      } else if (c === '"') q = false;
      else if (cur.length < MAX_CELL) cur += c;
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
    } else if (cur.length < MAX_CELL) cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** "Affiliate Email", "affiliate.email" and "affiliate-email" all read as affiliate_email. */
const norm = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, "_");

/**
 * Each alias group's column in a header row. Aliases are tried in order, so when a file has two candidate
 * columns (say provider_key and customer_key) the one listed first wins, whatever the file's column order.
 * A column claimed by one group is not reused for another.
 */
export function mapWith(aliases: Record<string, string[]>, header: string[]): Record<string, number> {
  const cells = header.map(norm);
  const out: Record<string, number> = {};
  const used = new Set<number>();
  for (const [key, names] of Object.entries(aliases)) {
    for (const n of names) {
      const i = cells.findIndex((h, j) => h === norm(n) && !used.has(j));
      if (i >= 0) {
        out[key] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

/** Referral code columns, shared by every file type so any of them can point at a partner. */
const CODE_ALIASES = [
  "code",
  "referral_code",
  "links_token",
  "link_token",
  "link_value",
  "ref_id",
  "default_ref_id",
  "promoter_ref_id",
  "token",
  "ref",
  "via",
  "slug",
  "partner_key",
  "gspk",
  "aff",
  "affiliate_code",
];

/** Header names used by Rewardful, FirstPromoter, Tolt and PartnerStack exports, mapped to ours. */
const ALIASES: Record<string, string[]> = {
  email: ["email", "partner_email", "affiliate_email", "promoter_email", "email_address", "e-mail"],
  name: ["name", "full_name", "partner_name", "affiliate_name", "promoter_name"],
  first: ["first_name", "firstname", "partner_first", "profile_first_name"],
  last: ["last_name", "lastname", "partner_last", "profile_last_name"],
  code: CODE_ALIASES,
  externalId: ["partner_id", "affiliate_id", "promoter_id", "id"],
  coupon: ["coupon", "coupon_code", "promo_code", "promotion_code", "coupon_token"],
  paypal: ["paypal_email", "profile_paypal_email", "paypal", "payout_email"],
  wise: ["wise_email"],
  website: ["website", "website_url", "profile_website", "url", "site"],
  country: ["country", "country_code", "profile_country", "shipping_address_country"],
  status: ["status", "state", "approved_status", "partner_status", "affiliate_status"],
};

export const mapHeaders = (header: string[]) => mapWith(ALIASES, header);

/** Words shown back to the founder for the columns a file was read with. */
const LABELS: Record<string, string> = {
  email: "email",
  name: "name",
  first: "first name",
  last: "last name",
  code: "referral code",
  coupon: "coupon",
  paypal: "PayPal email",
  website: "website",
  country: "country",
  status: "status",
  externalId: "partner ID",
  wise: "Wise email",
  partnerId: "partner ID",
  amount: "amount",
  currency: "currency",
  partnerEmail: "partner email",
  partnerCode: "partner code",
  customerId: "customer ID",
  customerEmail: "customer email",
  convertedAt: "converted date",
  unpaid: "unpaid",
  paid: "paid",
};

/** A referral code as the old tool wrote it: letters, digits, dash, underscore and dot, at most 64 (attribution reads 64). */
export function cleanCode(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .slice(0, 64);
}

// the domain labels exclude the dot, so no two parts can match the same characters (no backtracking blowup)
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>".]+(\.[^\s@,;<>".]+)+$/;

/** A partner's status in the old tool, mapped so a blocked affiliate does not come back approved. */
export function partnerStatus(raw: string): PartnerStatus {
  const s = raw.trim().toLowerCase();
  // Tolt "invited" and Rewardful "suspicious" have not been approved by the founder yet
  if (/^(pending|applied|waiting|unapproved|in_review|review|invited|suspicious)/.test(s)) return "pending";
  if (/^(rejected|declined|denied|disapproved)/.test(s)) return "rejected";
  if (/^(banned|blocked|suspended|fraud)/.test(s)) return "banned";
  if (/^(paused|inactive|disabled|archived|deactivated)/.test(s)) return "paused";
  return "approved";
}

/**
 * A customer's state in the old tool. Only active and canceled customers paid there; a trial or a lead
 * has not, so its first payment here is still its first sale.
 */
export function referralStatus(raw: string, hasCustomer: boolean): ReferralStatus | null {
  const s = raw.trim().toLowerCase();
  // FirstPromoter "denied" and "moved" are customers the old tool took away from the partner
  if (/^(denied|rejected|moved|fraud)$/.test(s)) return null;
  if (/^(canceled|cancelled|churned|inactive|suspended)$/.test(s)) return "canceled";
  if (/^(refunded)$/.test(s)) return "refunded";
  if (/^(trialing|trial|in_trial)$/.test(s)) return "trialing";
  // Rewardful "conversion", FirstPromoter "subscribed": paying customers even when the row has no billing id
  if (/^(active|conversion|converted|customer|paying|paid|subscribed)$/.test(s)) return "active";
  if (/^(lead|leads|signup|signed_up|visitor|pending|prospect)$/.test(s)) return "lead";
  return hasCustomer ? "active" : "lead";
}

/** "$1,234.50", "1234.5" or "1.234,50 €" → 1234.5 (major units); null when it is not a number. */
export function parseAmount(raw: string): number | null {
  // accounting style "(120.00)" is a negative amount
  const neg = /^\s*\(.*\)\s*$/.test(raw);
  // a currency code may sit before or after the number; any other letter ("1e9", "0x10", "12%") is refused
  const bare = raw.trim().replace(/^[A-Za-z]{3}\s+|\s+[A-Za-z]{3}$/g, "");
  if (/[A-Za-z%]/.test(bare)) return null;
  let s = bare.replace(/[^0-9.,-]/g, "");
  // "1.234" could be one thousand or one point two: too risky to guess with money
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return null;
  // "1.234,50" and "12,5": a comma followed by one or two digits at the end is the decimal mark
  s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -Math.abs(n) : n) : null;
}

/** What every import returns: counts, the columns it read, and a line for each row it left out. */
export interface ImportResult {
  created: number;
  skipped: number;
  columns: string[];
  notes: string[];
}

/** Parses the file, finds its columns and refuses a file that is empty or too long before anything is written. */
function readFile(csv: string, aliases: Record<string, string[]>, what: string) {
  if (typeof csv !== "string") throw new Error("Pick a CSV file to import");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error(`The file needs a header row and at least one ${what}`);
  if (rows.length - 1 > MAX_IMPORT_ROWS)
    throw new Error(
      `This file has ${(rows.length - 1).toLocaleString("en-US")} rows. Split it into files of ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows or fewer.`,
    );
  const cols = mapWith(aliases, rows[0]!);
  const get = (r: string[], k: string) => (cols[k] != null ? (r[cols[k]!] ?? "").trim() : "");
  const tally = { created: 0, skipped: 0, notes: [] as string[] };
  const skip = (row: number, why?: string) => {
    tally.skipped++;
    if (why && tally.notes.length < MAX_NOTES) tally.notes.push(`Row ${row}: ${why}`);
  };
  // the header is row 1, as in a spreadsheet
  const data = rows.slice(1).map((r, i) => ({ r, row: i + 2 }));
  return { cols, get, data, tally, skip };
}

/** How a row names its partner, for the skipped-row note. */
const refText = (ref: { email?: string; id?: string; code?: string }) =>
  ref.email || (ref.id && `with ID ${ref.id}`) || ref.code || "given";

const columnsOf = (cols: Record<string, number>) => Object.keys(cols).map((k) => LABELS[k] ?? k);

async function loadProgram(programId: string) {
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  if (!prog) throw new Error("Program not found");
  return prog;
}

/** Every partner in the program, by lowercase email and lowercase code, read once instead of per row. */
async function partnerIndex(programId: string) {
  const rows = await db()
    .select({ id: partner.id, email: partner.email, code: partner.code, externalId: partner.externalId })
    .from(partner)
    .where(eq(partner.programId, programId));
  const byEmail = new Map(rows.map((p) => [p.email.toLowerCase(), p]));
  const byCode = new Map(rows.map((p) => [p.code.toLowerCase(), p]));
  const byExternal = new Map(rows.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
  return {
    byEmail,
    byCode,
    byExternal,
    /** The partner a migration row points at: by email, then by the old tool's partner id, then by code. */
    find: (ref: { email?: string; id?: string; code?: string }) =>
      (ref.email && byEmail.get(ref.email.toLowerCase())) ||
      (ref.id && byExternal.get(ref.id)) ||
      (ref.code && byCode.get(ref.code.toLowerCase())) ||
      null,
  };
}

async function insertChunks<T>(tx: Tx, rows: T[], write: (tx: Tx, chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await write(tx, rows.slice(i, i + CHUNK));
}

const chunked = <T>(list: T[]) =>
  Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));

/**
 * Partners from the old tool. Codes stay exactly as exported so links already shared keep attributing
 * (op.js reads ?via=, ?fpr=, ?ref=, ?gspk= and ?aff=). A code another partner owns is never renamed: the row is
 * left out and listed. The whole file goes in one transaction.
 */
export async function importPartners(programId: string, csv: string, actor: Actor): Promise<ImportResult> {
  const prog = await loadProgram(programId);
  const { cols, get, data, tally, skip } = readFile(csv, ALIASES, "partner");
  if (cols.email == null)
    throw new Error("No email column found (looked for email, partner_email, affiliate_email…)");
  const [group] = await db()
    .select()
    .from(partnerGroup)
    .where(and(eq(partnerGroup.programId, programId), eq(partnerGroup.isDefault, true)));
  const idx = await partnerIndex(programId);
  const keys = new Set(
    (await db().select({ key: link.key }).from(link).where(eq(link.programId, programId))).map((l) =>
      l.key.toLowerCase(),
    ),
  );
  const coupons = new Map(
    (
      await db()
        .select({ code: promoCode.code, partnerId: promoCode.partnerId })
        .from(promoCode)
        .where(eq(promoCode.programId, programId))
    ).map((c) => [c.code.toUpperCase(), c.partnerId]),
  );
  const unique = (base: string, taken: (s: string) => boolean, max = 64) => {
    let s = base.slice(0, max);
    while (taken(s.toLowerCase())) s = `${base.slice(0, max - 3)}${createCode(3)}`;
    return s;
  };

  const partners: (typeof partner.$inferInsert)[] = [];
  const links: (typeof link.$inferInsert)[] = [];
  const promos: (typeof promoCode.$inferInsert)[] = [];
  const now = new Date();
  for (const { r, row } of data) {
    const email = get(r, "email").toLowerCase();
    if (!EMAIL.test(email)) {
      skip(row, email ? `${email} is not a valid email` : "no email");
      continue;
    }
    if (idx.byEmail.has(email)) {
      skip(row, `${email} is already a partner`);
      continue;
    }
    const name =
      get(r, "name") || [get(r, "first"), get(r, "last")].filter(Boolean).join(" ") || email.split("@")[0]!;
    const own = cleanCode(get(r, "code"));
    const owner = own ? idx.byCode.get(own.toLowerCase()) : undefined;
    if (owner) {
      // renaming would break every link this partner already shared, so leave it to the founder
      skip(row, `${email}: code ${own} belongs to ${owner.email}`);
      continue;
    }
    const code =
      own ||
      unique(slugify(name).replace(/-/g, "").slice(0, 12) || createCode(), (s) => idx.byCode.has(s), 16);
    const status = partnerStatus(get(r, "status"));
    const externalId = get(r, "externalId").slice(0, 120) || null;
    if (externalId && idx.byExternal.has(externalId)) {
      skip(row, `${email}: partner ID ${externalId} belongs to ${idx.byExternal.get(externalId)!.email}`);
      continue;
    }
    const paypal = get(r, "paypal").toLowerCase();
    const wise = get(r, "wise").toLowerCase();
    const p = {
      id: createId("prt"),
      programId,
      workspaceId: prog.workspaceId,
      email,
      name: name.slice(0, 120),
      code,
      externalId,
      status,
      approvedAt: status === "approved" ? now : null,
      groupId: group?.id ?? null,
      source: "import" as const,
      paypalEmail: EMAIL.test(paypal) ? paypal : null,
      wiseEmail: EMAIL.test(wise) ? wise : null,
      payoutMethod: EMAIL.test(paypal) ? ("paypal" as const) : EMAIL.test(wise) ? ("wise" as const) : null,
      website: get(r, "website").slice(0, 300) || null,
      country: /^[a-z]{2}$/i.test(get(r, "country")) ? get(r, "country").toUpperCase() : null,
    };
    partners.push(p);
    // later rows of the same file see this partner too
    idx.byEmail.set(email, p);
    idx.byCode.set(code.toLowerCase(), p);
    if (externalId) idx.byExternal.set(externalId, p);
    const key = unique(`${code}${createCode(2)}`, (s) => keys.has(s));
    keys.add(key.toLowerCase());
    links.push({
      id: createId("lnk"),
      programId,
      partnerId: p.id,
      key,
      destination: prog.websiteUrl,
      label: "Default link",
    });
    const coupon = get(r, "coupon").toUpperCase().slice(0, 64);
    if (coupon) {
      if (coupons.has(coupon))
        tally.notes.length < MAX_NOTES &&
          tally.notes.push(`Row ${row}: coupon ${coupon} is already taken. The partner came in without it.`);
      else {
        coupons.set(coupon, p.id);
        promos.push({ id: createId("prm"), programId, partnerId: p.id, code: coupon });
      }
    }
  }
  await db().transaction(async (tx) => {
    await insertChunks(tx, partners, (t, c) => t.insert(partner).values(c));
    await insertChunks(tx, links, (t, c) => t.insert(link).values(c));
    await insertChunks(tx, promos, (t, c) => t.insert(promoCode).values(c));
  });
  tally.created = partners.length;
  await audit(
    prog.workspaceId,
    actor,
    "partner.import",
    { type: "program", id: programId },
    {
      created: tally.created,
      skipped: tally.skipped,
    },
  );
  return { ...tally, columns: columnsOf(cols) };
}

/** Header names in referral and customer exports from the same tools, mapped to ours. */
const REFERRAL_ALIASES: Record<string, string[]> = {
  partnerEmail: ["partner_email", "affiliate_email", "promoter_email"],
  partnerId: ["partner_id", "affiliate_id", "promoter_id"],
  partnerCode: CODE_ALIASES.filter((c) => c !== "code"),
  // Stripe or Paddle ids first: PartnerStack files carry both provider_key (Stripe) and its own customer_key
  customerId: [
    "stripe_customer_id",
    "provider_key",
    "paddle_customer_id",
    "billing_customer_id",
    "customer_id",
    "uid",
    "external_id",
    "customer_key",
  ],
  customerEmail: ["customer_email", "email", "lead_email", "referral_email"],
  name: ["customer_name", "name"],
  status: ["status", "state", "conversion_state", "referral_status", "customer_status"],
  convertedAt: [
    "converted_at",
    "became_conversion_at",
    "conversion_date",
    "became_customer_at",
    "first_payment_at",
    "customer_since",
    "created_at",
  ],
};

/**
 * Customers a partner brought in before the switch. A row with the billing customer id makes renewals
 * pay that partner (ingest looks the customer up first); a row with only an email is matched on the
 * customer's next payment. No lead commission, bounty or email fires, since these are old referrals.
 */
export async function importReferrals(programId: string, csv: string, actor: Actor): Promise<ImportResult> {
  const prog = await loadProgram(programId);
  const { cols, get, data, tally, skip } = readFile(csv, REFERRAL_ALIASES, "customer");
  if (cols.partnerEmail == null && cols.partnerId == null && cols.partnerCode == null)
    throw new Error(
      "No partner column found (looked for partner_email, affiliate_email, partner_id, referral_code…)",
    );
  if (cols.customerId == null && cols.customerEmail == null)
    throw new Error("No customer column found (looked for stripe_customer_id, customer_id, customer_email…)");
  const idx = await partnerIndex(programId);

  // renewals look the customer up across the workspace's programs, so one customer must have one partner
  const ids = [...new Set(data.map(({ r }) => get(r, "customerId")).filter(Boolean))];
  const owners = new Map<string, string>();
  for (const part of chunked(ids)) {
    const found = await db()
      .select({ id: referral.externalCustomerId, programId: referral.programId })
      .from(referral)
      .innerJoin(program, eq(program.id, referral.programId))
      .where(and(eq(program.workspaceId, prog.workspaceId), inArray(referral.externalCustomerId, part)));
    for (const f of found) if (f.id) owners.set(f.id, f.programId);
  }
  // no billing id to make it unique, so the email is the key: a second run must not add it twice
  const emails = [...new Set(data.map(({ r }) => get(r, "customerEmail").toLowerCase()).filter(Boolean))];
  const seenEmails = new Set<string>();
  for (const part of chunked(emails)) {
    const found = await db()
      .select({ email: referral.email })
      .from(referral)
      .where(and(eq(referral.programId, programId), inArray(sql`lower(${referral.email})`, part)));
    for (const f of found) if (f.email) seenEmails.add(f.email.toLowerCase());
  }

  const rows: (typeof referral.$inferInsert)[] = [];
  const firstRow = new Map<string, number>();
  for (const { r, row } of data) {
    const ref = { email: get(r, "partnerEmail"), id: get(r, "partnerId"), code: get(r, "partnerCode") };
    const customerId = get(r, "customerId");
    const email = get(r, "customerEmail").toLowerCase();
    const validEmail = EMAIL.test(email);
    if (!customerId && !validEmail) {
      skip(row, "no customer ID or valid customer email");
      continue;
    }
    if (customerId.length > 200) {
      skip(row, "customer ID is longer than 200 characters");
      continue;
    }
    const status = referralStatus(get(r, "status"), !!customerId);
    if (!status) {
      skip(row, `status ${get(r, "status")} means the old tool did not credit this customer`);
      continue;
    }
    const p = idx.find(ref);
    if (!p) {
      skip(row, `no partner ${refText(ref)} in this program. Import partners first.`);
      continue;
    }
    const key = customerId ? `id:${customerId}` : `email:${email}`;
    if (firstRow.has(key)) {
      skip(row, `same customer as row ${firstRow.get(key)}`);
      continue;
    }
    firstRow.set(key, row);
    if (customerId && owners.has(customerId)) {
      skip(
        row,
        owners.get(customerId) === programId
          ? `customer ${customerId} is already referred`
          : `customer ${customerId} already belongs to another program`,
      );
      continue;
    }
    if (!customerId && seenEmails.has(email)) {
      skip(row, `customer ${email} is already referred`);
      continue;
    }
    const paid = status === "active" || status === "canceled" || status === "refunded";
    const when = get(r, "convertedAt") ? new Date(get(r, "convertedAt")) : null;
    rows.push({
      id: createId("ref"),
      programId,
      partnerId: p.id,
      email: validEmail ? email : null,
      name: get(r, "name").slice(0, 120) || null,
      externalCustomerId: customerId || null,
      via: "import",
      status,
      // unknown date stays empty: the first renewal here sets it, and that starts any months window
      convertedAt: paid && when && !Number.isNaN(when.getTime()) && when <= new Date() ? when : null,
      // the old tool already paid the first sale, so a one-time plan or a first-sale bounty must not pay again
      paidInvoices: paid ? 1 : 0,
      canceledAt: status === "canceled" ? new Date() : null,
    });
  }
  await db().transaction(async (tx) => {
    // the unique (program, customer) index still guards a race with a webhook arriving mid-import
    await insertChunks(tx, rows, async (t, c) => {
      const got = await t.insert(referral).values(c).onConflictDoNothing().returning({ id: referral.id });
      tally.created += got.length;
      tally.skipped += c.length - got.length;
    });
  });
  await audit(
    prog.workspaceId,
    actor,
    "referral.import",
    { type: "program", id: programId },
    {
      created: tally.created,
      skipped: tally.skipped,
    },
  );
  return { ...tally, columns: columnsOf(cols) };
}

const BALANCE_ALIASES: Record<string, string[]> = {
  // a bare "email" comes last: in a commission export it can be the customer's, not the partner's
  partnerEmail: ["partner_email", "affiliate_email", "promoter_email", "email"],
  partnerId: ["partner_id", "affiliate_id", "promoter_id"],
  partnerCode: CODE_ALIASES.filter((c) => c !== "code"),
  unpaid: [
    "unpaid",
    "unpaid_commissions",
    "unpaid_balance",
    "commission_unpaid",
    "stats_commission_unpaid",
    "current_balance_cash",
    "current_balance",
    "balance",
    "amount_due",
    "due",
  ],
  pending: ["pending", "pending_commissions", "pending_balance", "on_hold"],
  paid: [
    "paid",
    "total_paid",
    "paid_commissions",
    "commission_paid",
    "stats_commission_paid",
    "paid_balance_cash",
    "paid_balance",
    "paid_out",
    "lifetime_paid",
  ],
  // a file of single commissions (Rewardful and Tolt have no balance export)
  amount: ["amount", "commission_amount", "amount_in_cents", "amount_in_dollars", "commission"],
  status: ["status", "state", "commission_status"],
  currency: ["currency", "currency_code"],
  commissionId: ["commission_id", "id"],
};

/** Columns whose names say the numbers are cents (PartnerStack stats are in cents). */
const CENT_COLUMNS = /(_cents|^commission_unpaid|^commission_paid|^stats_commission_)/;

type Bucket = "unpaid" | "pending" | "paid";

/** A single commission's state in the old tool: which balance it belongs to, or null when it was never owed. */
export function commissionBucket(raw: string): Bucket | null | undefined {
  const s = raw.trim().toLowerCase();
  if (/^(paid|paid_out|completed)$/.test(s)) return "paid";
  if (/^(due|approved|unpaid|payable|owed|processing)$/.test(s)) return "unpaid";
  if (/^(pending|hold|held|on_hold|in_review)$/.test(s)) return "pending";
  if (/^(voided|void|rejected|refunded|denied|declined|canceled|cancelled|reversed)$/.test(s)) return null;
  return undefined;
}

const BUCKETS: Record<Bucket, { status: "approved" | "pending" | "paid"; total: string; single: string }> = {
  unpaid: {
    status: "approved",
    total: "Unpaid balance carried over from the previous affiliate tool",
    single: "Unpaid commission carried over from the previous affiliate tool",
  },
  pending: {
    status: "pending",
    total: "Pending commissions carried over from the previous affiliate tool",
    single: "Pending commission carried over from the previous affiliate tool",
  },
  paid: {
    status: "paid",
    total: "Already paid in the previous affiliate tool",
    single: "Commission already paid in the previous affiliate tool",
  },
};

const digest = (s: string) => createHash("sha256").update(s).digest("base64url").slice(0, 22);

/**
 * What each partner was owed and had been paid in the old tool, in the program's currency. The file holds
 * either one row per partner with unpaid, pending and paid totals, or one row per commission with an amount
 * and a status. Unpaid becomes approved for the next payout; pending waits out the program's hold period like
 * any new commission; paid only counts toward the lifetime total.
 *
 * Re-running a file never doubles money. A totals row has one key per partner and bucket, so a corrected
 * totals file cannot add to what came in. A single commission keys on the old tool's commission id, or on
 * its own contents and how many identical rows came before it, so a commission list split across files adds
 * up while each file stays a no-op the second time.
 */
export async function importBalances(
  programId: string,
  csv: string,
  actor: Actor,
  opts: { cents?: boolean } = {},
): Promise<ImportResult> {
  const prog = await loadProgram(programId);
  const { cols, get, data, tally, skip } = readFile(csv, BALANCE_ALIASES, "partner");
  if (cols.partnerEmail == null && cols.partnerId == null && cols.partnerCode == null)
    throw new Error("No partner column found (looked for email, partner_email, partner_id, referral_code…)");
  const perPartner = cols.unpaid != null || cols.pending != null || cols.paid != null;
  if (!perPartner && cols.amount == null)
    throw new Error("No amount column found (looked for unpaid, total_paid, amount…)");
  if (!perPartner && cols.status == null)
    throw new Error("A file of single commissions needs a status column to tell paid from unpaid");
  const header = parseCsv(csv)[0]!.map(norm);
  const inCents = (k: string) => opts.cents === true || CENT_COLUMNS.test(header[cols[k]!] ?? "");
  const idx = await partnerIndex(programId);
  const done = new Set(
    (
      await db()
        .select({ key: commission.sourceKey })
        .from(commission)
        .where(and(eq(commission.programId, programId), like(commission.sourceKey, "import:%")))
    ).map((c) => c.key),
  );
  const holdUntil = new Date(Date.now() + prog.holdDays * 86_400_000);
  const line = (partnerId: string, b: Bucket, amount: number, sourceKey: string, text: string) => ({
    id: createId("com"),
    programId,
    workspaceId: prog.workspaceId,
    partnerId,
    kind: "adjustment" as const,
    sourceKey,
    amount,
    currency: prog.currency,
    fxRate: 1,
    status: BUCKETS[b].status,
    holdUntil: b === "pending" ? holdUntil : null,
    description: text,
  });

  const rows: (typeof commission.$inferInsert)[] = [];
  const firstRow = new Map<string, number>();
  const twins = new Map<string, number>();
  for (const { r, row } of data) {
    const ref = { email: get(r, "partnerEmail"), id: get(r, "partnerId"), code: get(r, "partnerCode") };
    const currency = get(r, "currency").toLowerCase();
    if (currency && currency !== prog.currency.toLowerCase()) {
      skip(
        row,
        `amount is in ${currency.toUpperCase()} but this program pays in ${prog.currency.toUpperCase()}`,
      );
      continue;
    }
    // an empty cell means nothing; a value we cannot read skips the row, never books zero
    const minor = (k: string): number | null => {
      if (cols[k] == null || !get(r, k)) return 0;
      const n = parseAmount(get(r, k));
      if (n == null) return null;
      return inCents(k) ? Math.round(n) : toMinor(n, prog.currency);
    };
    let add: Partial<Record<Bucket, number | null>>;
    if (perPartner) add = { unpaid: minor("unpaid"), pending: minor("pending"), paid: minor("paid") };
    else {
      const bucket = commissionBucket(get(r, "status"));
      if (bucket === null) {
        // voided, refunded or rejected in the old tool: never owed, nothing to bring over
        tally.skipped++;
        continue;
      }
      if (bucket === undefined) {
        skip(row, `status "${get(r, "status")}" is not one we know (paid, due, approved, pending, voided…)`);
        continue;
      }
      add = { [bucket]: minor("amount") };
    }
    const values = Object.values(add);
    if (values.some((v) => v == null)) {
      skip(row, "an amount could not be read for sure (write it like 1234.50)");
      continue;
    }
    if (values.some((v) => (v ?? 0) < 0)) {
      skip(row, "an amount is below zero. Add it under Commissions instead.");
      continue;
    }
    if (values.some((v) => (v ?? 0) > MAX_MINOR)) {
      skip(row, "an amount is too large to be right. Check the file.");
      continue;
    }
    const p = idx.find(ref);
    if (!p) {
      skip(row, `no partner ${refText(ref)} in this program. Import partners first.`);
      continue;
    }
    if (perPartner) {
      if (firstRow.has(p.id)) {
        skip(row, `same partner as row ${firstRow.get(p.id)}`);
        continue;
      }
      firstRow.set(p.id, row);
      const lines = (Object.keys(BUCKETS) as Bucket[])
        .filter((b) => (add[b] ?? 0) > 0)
        .map((b) => ({ b, key: `import:${b}:${p.id}` }));
      if (!lines.length) {
        skip(row, "both amounts are zero");
        continue;
      }
      const fresh = lines.filter((l) => !done.has(l.key));
      if (fresh.length < lines.length) {
        skip(row, `${p.email} already has imported balances. Change them under Commissions.`);
        continue;
      }
      for (const l of fresh) rows.push(line(p.id, l.b, add[l.b]!, l.key, BUCKETS[l.b].total));
    } else {
      const [b, amount] = Object.entries(add)[0] as [Bucket, number];
      if (amount <= 0) {
        tally.skipped++;
        continue;
      }
      const oldId = get(r, "commissionId");
      // without the old tool's id, a commission is known by its contents and how many identical rows came first
      const body = `${p.id}|${b}|${amount}|${r.map((c) => c.trim()).join("|")}`;
      const nth = (twins.get(body) ?? 0) + 1;
      twins.set(body, nth);
      const key = `import:c:${p.id}:${digest(oldId ? `id:${oldId}` : `${body}#${nth}`)}`;
      if (done.has(key)) {
        skip(row, "this commission was already imported");
        continue;
      }
      done.add(key);
      rows.push(line(p.id, b, amount, key, BUCKETS[b].single));
    }
  }
  const partners = new Set<string>();
  await db().transaction(async (tx) => {
    await insertChunks(tx, rows, async (t, c) => {
      const got = await t
        .insert(commission)
        .values(c)
        .onConflictDoNothing()
        .returning({ partnerId: commission.partnerId });
      for (const g of got) partners.add(g.partnerId);
    });
  });
  tally.created = partners.size;
  await audit(
    prog.workspaceId,
    actor,
    "balance.import",
    { type: "program", id: programId },
    {
      created: tally.created,
      skipped: tally.skipped,
    },
  );
  return { ...tally, columns: columnsOf(cols) };
}
