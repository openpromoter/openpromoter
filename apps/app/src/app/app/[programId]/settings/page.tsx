import { partnerGroup } from "@openpromoter/db";
import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { ProgramForm, TiersCard } from "./program-form";

export const metadata: Metadata = { title: "Program settings" };

export default async function ProgramSettings({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p, role } = await programCtx(programId);
  const groups = await db()
    .select()
    .from(partnerGroup)
    .where(eq(partnerGroup.programId, programId))
    .orderBy(asc(partnerGroup.rank));
  const canWrite = role === "owner" || role === "admin";
  return (
    <>
      <ProgramForm
        programId={programId}
        canWrite={canWrite}
        rationale={p.designRationale}
        p={{
          name: p.name,
          websiteUrl: p.websiteUrl,
          currency: p.currency.toUpperCase(),
          commissionType: p.commissionType,
          commissionValue:
            p.commissionType === "percent"
              ? String(p.commissionValue / 100)
              : (p.commissionValue / 100).toFixed(2),
          commissionDuration: p.commissionDuration,
          commissionMonths: String(p.commissionMonths || 12),
          leadCommission: (p.leadCommission / 100).toFixed(2),
          overridePercent: String(p.overrideRate / 100),
          cookieDays: String(p.cookieDays),
          attributionModel: p.attributionModel,
          referralParam: p.referralParam,
          holdDays: String(p.holdDays),
          minPayout: (p.minPayout / 100).toFixed(2),
          payoutSchedule: p.payoutSchedule,
          fraudHoldScore: String(p.fraudHoldScore),
          visibility: p.visibility,
          doubleSidedPercent: String(p.doubleSided.percentOff),
          doubleSidedMonths: String(p.doubleSided.durationMonths),
          doubleSidedCoupon: p.doubleSided.stripeCouponId ?? "",
          terms: p.terms ?? "",
        }}
      />
      <TiersCard
        programId={programId}
        canWrite={canWrite}
        currency={p.currency}
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          rate: g.commissionValue != null ? String(g.commissionValue / 100) : "",
          promoteAt: g.promoteAtRevenue != null ? String(g.promoteAtRevenue / 100) : "",
          isDefault: g.isDefault,
        }))}
      />
    </>
  );
}
