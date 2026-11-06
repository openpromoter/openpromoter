import { partner, referral } from "@openpromoter/db";
import { and, asc, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { like, listParams } from "@/lib/list";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { CustomersTable } from "./table";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { programId } = await params;
  const sp = await searchParams;
  const { program: prog } = await programCtx(programId);
  const lp = listParams(sp);
  const where: SQL[] = [eq(referral.programId, programId)];
  if (lp.status) where.push(eq(referral.status, lp.status as "lead"));
  if (lp.partner) where.push(eq(referral.partnerId, lp.partner));
  if (lp.q)
    where.push(
      or(
        ilike(referral.email, like(lp.q)),
        ilike(referral.name, like(lp.q)),
        ilike(referral.externalCustomerId, like(lp.q)),
        ilike(partner.name, like(lp.q)),
      )!,
    );
  const sortCol =
    { revenue: referral.revenue, mrr: referral.mrr, createdAt: referral.createdAt }[
      lp.sort?.key ?? "createdAt"
    ] ?? referral.createdAt;
  const [rows, [count], counts] = await Promise.all([
    db()
      .select({
        id: referral.id,
        email: referral.email,
        name: referral.name,
        status: referral.status,
        via: referral.via,
        revenue: referral.revenue,
        mrr: referral.mrr,
        createdAt: referral.createdAt,
        convertedAt: referral.convertedAt,
        partnerId: partner.id,
        partnerName: partner.name,
        customerId: referral.externalCustomerId,
      })
      .from(referral)
      .innerJoin(partner, eq(partner.id, referral.partnerId))
      .where(and(...where))
      .orderBy(lp.sort?.dir === "asc" ? asc(sortCol) : desc(sortCol))
      .limit(lp.pageSize)
      .offset((lp.page - 1) * lp.pageSize),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(referral)
      .innerJoin(partner, eq(partner.id, referral.partnerId))
      .where(and(...where)),
    db()
      .select({ s: referral.status, n: sql<number>`count(*)::int` })
      .from(referral)
      .where(eq(referral.programId, programId))
      .groupBy(referral.status),
  ]);
  const c = (s: string) => counts.find((x) => x.s === s)?.n ?? 0;
  return (
    <>
      <PageHeader
        title="Customers"
        description="Signups and customers your partners referred. Status follows Stripe: trials, upgrades, cancellations and refunds update automatically."
      />
      <CustomersTable
        programId={programId}
        currency={prog.currency}
        rows={rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          convertedAt: r.convertedAt?.toISOString() ?? null,
        }))}
        total={count?.n ?? 0}
        page={lp.page}
        pageSize={lp.pageSize}
        tabs={[
          { label: "All", query: "", count: counts.reduce((a, x) => a + x.n, 0) },
          { label: "Paying", query: "status=active", count: c("active") },
          { label: "Trials", query: "status=trialing", count: c("trialing") },
          { label: "Leads", query: "status=lead", count: c("lead") },
          { label: "Canceled", query: "status=canceled", count: c("canceled") },
          { label: "Refunded", query: "status=refunded", count: c("refunded") },
        ]}
      />
    </>
  );
}
