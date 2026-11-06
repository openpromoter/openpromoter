import { commission, partner, partnerGroup, referral } from "@openpromoter/db";
import { and, asc, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { like, listParams } from "@/lib/list";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { InviteButton, PartnersTable } from "../partners-table";

export const metadata: Metadata = { title: "Partners" };

export default async function PartnersPage({
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
  const where: SQL[] = [eq(partner.programId, programId)];
  if (lp.status) where.push(eq(partner.status, lp.status as "pending"));
  if (sp.group) where.push(eq(partner.groupId, sp.group));
  if (sp.risk === "high") where.push(sql`${partner.riskScore} >= ${prog.fraudHoldScore}`);
  if (lp.q)
    where.push(
      or(ilike(partner.name, like(lp.q)), ilike(partner.email, like(lp.q)), ilike(partner.code, like(lp.q)))!,
    );

  const revenue = sql<number>`coalesce((select sum(${commission.saleAmount}) from ${commission} where ${commission.partnerId} = ${sql.raw('"partner"."id"')}),0)::bigint`;
  const earned = sql<number>`coalesce((select sum(${commission.amount}) from ${commission} where ${commission.partnerId} = ${sql.raw('"partner"."id"')} and ${commission.status} <> 'reversed'),0)::bigint`;
  const customers = sql<number>`(select count(*) from ${referral} where ${referral.partnerId} = ${sql.raw('"partner"."id"')} and ${referral.convertedAt} is not null)::int`;
  const sortCol =
    { revenue, earned, customers, name: partner.name, createdAt: partner.createdAt, risk: partner.riskScore }[
      lp.sort?.key ?? "createdAt"
    ] ?? partner.createdAt;

  const [rows, [count], groups, counts] = await Promise.all([
    db()
      .select({
        id: partner.id,
        name: partner.name,
        email: partner.email,
        status: partner.status,
        code: partner.code,
        riskScore: partner.riskScore,
        createdAt: partner.createdAt,
        group: partnerGroup.name,
        revenue,
        earned,
        customers,
        country: partner.country,
        source: partner.source,
      })
      .from(partner)
      .leftJoin(partnerGroup, eq(partnerGroup.id, partner.groupId))
      .where(and(...where))
      .orderBy(lp.sort?.dir === "asc" ? asc(sortCol) : desc(sortCol))
      .limit(lp.pageSize)
      .offset((lp.page - 1) * lp.pageSize),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(partner)
      .where(and(...where)),
    db().select().from(partnerGroup).where(eq(partnerGroup.programId, programId)).orderBy(partnerGroup.rank),
    db()
      .select({ status: partner.status, n: sql<number>`count(*)::int` })
      .from(partner)
      .where(eq(partner.programId, programId))
      .groupBy(partner.status),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?.n ?? 0;
  const all = counts.reduce((a, x) => a + x.n, 0);

  return (
    <>
      <PageHeader
        title="Partners"
        description="Everyone promoting your product. Applications that match your rules are approved automatically."
        actions={
          <InviteButton
            programId={programId}
            groups={groups.map((g) => ({ id: g.id, name: g.name }))}
            openByDefault={sp.invite === "1"}
          />
        }
      />
      <PartnersTable
        programId={programId}
        currency={prog.currency}
        rows={rows.map((r) => ({
          ...r,
          revenue: Number(r.revenue),
          earned: Number(r.earned),
          createdAt: r.createdAt.toISOString(),
        }))}
        total={count?.n ?? 0}
        page={lp.page}
        pageSize={lp.pageSize}
        tabs={[
          { label: "All", query: "", count: all },
          { label: "Needs approval", query: "status=pending", count: c("pending") },
          { label: "Active", query: "status=approved", count: c("approved") },
          { label: "Top earners", query: "status=approved&sort=revenue:desc" },
          { label: "High risk", query: "risk=high" },
          { label: "Paused", query: "status=paused", count: c("paused") },
        ]}
      />
    </>
  );
}
