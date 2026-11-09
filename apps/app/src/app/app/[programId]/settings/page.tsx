import { billingPrice, partnerGroup } from "@openpromoter/db";
import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { priceLabel } from "@/lib/program-labels";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { ProductRatesCard, ProgramForm, TiersCard } from "./program-form";

export const metadata: Metadata = { title: "Program settings" };

export default async function ProgramSettings({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p, role } = await programCtx(programId);
  const groups = await db()
    .select()
    .from(partnerGroup)
    .where(eq(partnerGroup.programId, programId))
    .orderBy(asc(partnerGroup.rank));
  const prices = await db()
    .select()
    .from(billingPrice)
    .where(and(eq(billingPrice.workspaceId, p.workspaceId), eq(billingPrice.active, true)))
    .orderBy(asc(billingPrice.productName), asc(billingPrice.unitAmount))
    .limit(200);
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
          commissionAfterValue:
            p.commissionAfterValue == null
              ? ""
              : p.commissionType === "percent"
                ? String(p.commissionAfterValue / 100)
                : (p.commissionAfterValue / 100).toFixed(2),
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
      <ProductRatesCard
        programId={programId}
        canWrite={canWrite}
        currency={p.currency}
        rates={p.productRates.map((r) => ({
          id: r.id,
          label: r.label,
          type: r.type,
          rate: r.type === "percent" ? String(r.value / 100) : (r.value / 100).toFixed(2),
        }))}
        prices={prices.map((x) => ({ id: x.externalId, label: priceLabel(x) }))}
      />
    </>
  );
}
