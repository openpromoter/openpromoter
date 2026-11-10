import { auditLog, commission, partner, payout, referral } from "@openpromoter/db";
import { and, desc, eq, gte, ilike, lt, or, type SQL, sql } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { csvResponse, toCsv } from "@/lib/csv";
import { like, listParams, statusIs } from "@/lib/list";
import { toMajor } from "@/lib/money";
import { nec1099Threshold } from "@/lib/tax";
import { AccessError, requireProgram } from "@/server/access";
import { parseRange, timeseries } from "@/server/analytics";
import { audit } from "@/server/audit";
import { currentUser } from "@/server/context";
import { db } from "@/server/db";
import { csvStream, keyset } from "@/server/exports";

async function* mapPages<T, U>(pages: AsyncIterable<T[]>, fn: (row: T) => U) {
  for await (const page of pages) yield page.map(fn);
}

const money = (n: number, currency: string) => toMajor(n, currency);

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const url = new URL(req.url);
  const u = await currentUser();
  if (!u) return new Response("Sign in", { status: 401 });
  const programId = url.searchParams.get("program") ?? "";
  let ctx: Awaited<ReturnType<typeof requireProgram>>;
  try {
    ctx = await requireProgram(
      u.id,
      programId,
      ["payouts", "1099", "commissions"].includes(kind) ? "money.write" : "read",
    );
  } catch (e) {
    return new Response((e as Error).message, { status: e instanceof AccessError ? e.status : 500 });
  }
  const p = ctx.program;
  // the export gets the same tab, search and partner filter as the list it was clicked from
  const lp = listParams(Object.fromEntries(url.searchParams));
  const q = lp.q ? like(lp.q) : null;
  const partnerFilter: SQL[] = [
    ...(lp.status ? [statusIs(partner.status, lp.status)!] : []),
    ...(url.searchParams.get("group") ? [eq(partner.groupId, url.searchParams.get("group")!)] : []),
    ...(url.searchParams.get("risk") === "high" ? [sql`${partner.riskScore} >= ${p.fraudHoldScore}`] : []),
    ...(q ? [or(ilike(partner.name, q), ilike(partner.email, q), ilike(partner.code, q))!] : []),
  ];
  const customerFilter: SQL[] = [
    ...(lp.status ? [statusIs(referral.status, lp.status)!] : []),
    ...(lp.partner ? [eq(referral.partnerId, lp.partner)] : []),
    ...(q
      ? [
          or(
            ilike(referral.email, q),
            ilike(referral.name, q),
            ilike(referral.externalCustomerId, q),
            ilike(partner.name, q),
          )!,
        ]
      : []),
  ];
  const commissionFilter: SQL[] = [
    // refund-matching alias rows are bookkeeping, hidden in the list too
    sql`not (${commission.kind} = 'adjustment' and ${commission.amount} = 0)`,
    ...(lp.status ? [statusIs(commission.status, lp.status)!] : []),
    ...(lp.partner ? [eq(commission.partnerId, lp.partner)] : []),
    ...(url.searchParams.get("kind") ? [statusIs(commission.kind, url.searchParams.get("kind"))!] : []),
    ...(q ? [or(ilike(partner.name, q), ilike(commission.description, q), ilike(commission.id, q))!] : []),
  ];
  const date = new Date().toISOString().slice(0, 10);
  switch (kind) {
    // list exports stream page by page (see server/exports.ts): memory stays flat at 1M rows
    case "partners":
      return csvStream(
        `partners-${date}.csv`,
        [
          "id",
          "name",
          "email",
          "status",
          "code",
          "website",
          "country",
          "risk_score",
          "payout_method",
          "created_at",
        ],
        mapPages(
          keyset(
            partner,
            (after, order, n) =>
              db()
                .select()
                .from(partner)
                .where(and(eq(partner.programId, programId), ...partnerFilter, after))
                .orderBy(...order)
                .limit(n),
            (r) => r,
          ),
          (r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            status: r.status,
            code: r.code,
            website: r.website,
            country: r.country,
            risk_score: r.riskScore,
            payout_method: r.payoutMethod,
            created_at: r.createdAt,
          }),
        ),
      );
    case "customers":
      return csvStream(
        `customers-${date}.csv`,
        [
          "id",
          "email",
          "partner",
          "status",
          "via",
          "customer_id",
          "revenue",
          "mrr",
          "signed_up",
          "first_paid",
        ],
        mapPages(
          keyset(
            referral,
            (after, order, n) =>
              db()
                .select({ r: referral, partner: partner.name })
                .from(referral)
                .innerJoin(partner, eq(partner.id, referral.partnerId))
                .where(and(eq(referral.programId, programId), ...customerFilter, after))
                .orderBy(...order)
                .limit(n),
            (x) => x.r,
          ),
          ({ r, partner: pn }) => ({
            id: r.id,
            email: r.email,
            partner: pn,
            status: r.status,
            via: r.via,
            customer_id: r.externalCustomerId,
            revenue: money(r.revenue, p.currency),
            mrr: money(r.mrr, p.currency),
            signed_up: r.createdAt,
            first_paid: r.convertedAt,
          }),
        ),
      );
    case "commissions":
      return csvStream(
        `commissions-${date}.csv`,
        [
          "id",
          "partner",
          "kind",
          "status",
          "sale",
          "commission",
          "currency",
          "description",
          "payout_id",
          "created_at",
        ],
        mapPages(
          keyset(
            commission,
            (after, order, n) =>
              db()
                .select({ c: commission, partner: partner.name })
                .from(commission)
                .innerJoin(partner, eq(partner.id, commission.partnerId))
                .where(and(eq(commission.programId, programId), ...commissionFilter, after))
                .orderBy(...order)
                .limit(n),
            (x) => x.c,
          ),
          ({ c, partner: pn }) => ({
            id: c.id,
            partner: pn,
            kind: c.kind,
            status: c.status,
            sale: money(c.saleAmount, c.currency),
            commission: money(c.amount, c.currency),
            currency: c.currency,
            description: c.description,
            payout_id: c.payoutId,
            created_at: c.createdAt,
          }),
        ),
      );
    case "payouts":
      return csvStream(
        `payouts-${date}.csv`,
        [
          "invoice",
          "partner",
          "email",
          "amount",
          "currency",
          "method",
          "status",
          "paypal_email",
          "reference",
          "paid_at",
        ],
        mapPages(
          keyset(
            payout,
            (after, order, n) =>
              db()
                .select({ po: payout, pt: partner })
                .from(payout)
                .innerJoin(partner, eq(partner.id, payout.partnerId))
                .where(and(eq(payout.programId, programId), after))
                .orderBy(...order)
                .limit(n),
            (x) => x.po,
          ),
          ({ po, pt }) => ({
            invoice: po.invoiceNumber,
            partner: pt.name,
            email: pt.email,
            amount: money(po.amount, po.currency),
            currency: po.currency.toUpperCase(),
            method: po.method,
            status: po.status,
            paypal_email: pt.paypalEmail,
            reference: po.externalId,
            paid_at: po.paidAt,
          }),
        ),
      );
    case "1099": {
      const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear() - 1;
      const full = url.searchParams.get("tin") === "full";
      const rows = await db()
        .select({ pt: partner, total: sql<number>`sum(${payout.amount})::bigint` })
        .from(payout)
        .innerJoin(partner, eq(partner.id, payout.partnerId))
        .where(
          and(
            eq(payout.programId, programId),
            eq(payout.status, "paid"),
            // a 1099-NEC reports US dollars; other currencies need converting by hand
            eq(payout.currency, "usd"),
            gte(payout.paidAt, new Date(Date.UTC(year, 0, 1))),
            lt(payout.paidAt, new Date(Date.UTC(year + 1, 0, 1))),
          ),
        )
        .groupBy(partner.id);
      const threshold = nec1099Threshold(year);
      const out = rows
        .filter(
          (r) =>
            (r.pt.country ?? "US").toUpperCase() === "US" &&
            r.pt.taxFormType !== "w8ben" &&
            r.pt.taxFormType !== "w8bene",
        )
        .map((r) => {
          const tin = r.pt.taxIdEnc ? decrypt(r.pt.taxIdEnc) : "";
          return {
            partner_id: r.pt.id,
            legal_name: r.pt.taxLegalName ?? r.pt.name,
            address: r.pt.taxAddress,
            email: r.pt.email,
            tin: full ? tin : tin ? `***-**-${tin.slice(-4)}` : "MISSING",
            box1_nonemployee_comp: money(Number(r.total), "usd"),
            requires_1099: Number(r.total) >= threshold ? "yes" : "no",
            w9_status: r.pt.taxFormStatus,
          };
        });
      if (full)
        await audit(
          p.workspaceId,
          { type: "user", id: u.id },
          "tax.export_full_tin",
          { type: "program", id: programId },
          { year, rows: out.length },
        );
      return csvResponse(toCsv(out), `1099-nec-${year}-${p.slug}.csv`);
    }
    case "analytics": {
      const rows = await timeseries(programId, parseRange({ days: url.searchParams.get("days") }));
      return csvResponse(
        toCsv(
          rows.map((r) => ({
            ...r,
            revenue: money(r.revenue, p.currency),
            commissions: money(r.commissions, p.currency),
          })),
        ),
        `analytics-${date}.csv`,
      );
    }
    case "audit": {
      const rows = await db()
        .select()
        .from(auditLog)
        .where(eq(auditLog.workspaceId, p.workspaceId))
        .orderBy(desc(auditLog.createdAt))
        .limit(50_000);
      return csvResponse(
        toCsv(
          rows.map((r) => ({
            at: r.createdAt,
            actor_type: r.actorType,
            actor_id: r.actorId,
            action: r.action,
            target: r.targetType ? `${r.targetType}:${r.targetId}` : "",
            data: r.data ? JSON.stringify(r.data) : "",
          })),
        ),
        `audit-${date}.csv`,
      );
    }
  }
  return new Response("Unknown export", { status: 404 });
}
