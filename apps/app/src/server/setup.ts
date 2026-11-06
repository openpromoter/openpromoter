import { billingPrice, member, partnerGroup, program, workspace } from "@openpromoter/db";
import { and, asc, eq } from "drizzle-orm";
import { createCode, createId, slugify } from "@/lib/id";
import { fetchSite } from "./ai/brand";
import { designProgram, type ProgramDesign } from "./ai/designer";
import { type Actor, audit } from "./audit";
import { db } from "./db";
import { enqueue } from "./jobs";

async function uniqueSlug(table: typeof program | typeof workspace, base: string) {
  let slug = slugify(base) || "program";
  for (let i = 0; i < 6; i++) {
    const [taken] = await db().select({ id: table.id }).from(table).where(eq(table.slug, slug));
    if (!taken) return slug;
    slug = `${slugify(base).slice(0, 30)}-${createCode(4)}`;
  }
  return `${slug}-${createCode(6)}`;
}

/** Step 1: one URL in, a branded workspace + program out. */
export async function createProgramFromUrl(
  userId: string,
  websiteUrl: string,
  opts: { workspaceId?: string; name?: string } = {},
) {
  const site = await fetchSite(websiteUrl);
  const name = opts.name?.trim() || site.name;
  let wsId = opts.workspaceId;
  if (!wsId) {
    wsId = createId("ws");
    await db()
      .insert(workspace)
      .values({
        id: wsId,
        name,
        slug: await uniqueSlug(workspace, name),
        trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
      });
    await db().insert(member).values({ workspaceId: wsId, userId, role: "owner" });
  }
  const [p] = await db()
    .insert(program)
    .values({
      id: createId("prg"),
      workspaceId: wsId,
      name,
      slug: await uniqueSlug(program, name),
      websiteUrl: site.url,
      brand: {
        color: site.color,
        logoUrl: site.logoUrl,
        headline: `Earn by recommending ${name}`,
        description: site.description ?? site.headline ?? undefined,
      },
      autoApprove: {
        enabled: true,
        maxRiskScore: 40,
        requireWebsite: false,
        blockedCountries: [],
        allowedEmailDomains: [],
      },
      doubleSided: { enabled: false, percentOff: 0, durationMonths: 0 },
      terms: defaultTerms(name),
    })
    .returning();
  await db()
    .insert(partnerGroup)
    .values({ id: createId("grp"), programId: p!.id, name: "Partner", rank: 0, isDefault: true });
  await audit(
    wsId,
    { type: "user", id: userId },
    "program.create",
    { type: "program", id: p!.id },
    { websiteUrl: site.url },
  );
  await enqueue("content.generate", { programId: p!.id });
  return p!;
}

export function defaultTerms(name: string) {
  return `1. You earn commission on customers who buy ${name} through your link or code, as described on the program page.
2. Commissions are pending during the refund window and are reversed if the customer is refunded or charges back.
3. No self-referrals, no bidding on our brand name in paid search, no spam and no misleading claims.
4. We pay approved commissions once you reach the minimum payout. You are responsible for your own taxes.
5. We may change or end the program with 30 days' notice. Commissions that are earned and approved are always paid.`;
}

export async function proposeDesign(
  programId: string,
): Promise<ProgramDesign & { source: "ai" | "heuristic" }> {
  const [p] = await db().select().from(program).where(eq(program.id, programId));
  if (!p) throw new Error("Program not found");
  const prices = await db()
    .select()
    .from(billingPrice)
    .where(and(eq(billingPrice.workspaceId, p.workspaceId), eq(billingPrice.active, true)))
    .orderBy(asc(billingPrice.unitAmount))
    .limit(30);
  return designProgram({
    workspaceId: p.workspaceId,
    programName: p.name,
    description: p.brand.description,
    prices: prices.map((x) => ({
      productName: x.productName,
      unitAmount: x.unitAmount,
      currency: x.currency,
      interval: x.interval,
    })),
  });
}

/** One click: apply the AI design (program terms + tiers). */
export async function applyDesign(programId: string, d: ProgramDesign, actor: Actor) {
  const [p] = await db()
    .update(program)
    .set({
      commissionType: d.commissionType,
      commissionValue: d.commissionValue,
      commissionDuration: d.commissionDuration,
      commissionMonths: d.commissionMonths,
      cookieDays: d.cookieDays,
      holdDays: d.holdDays,
      minPayout: d.minPayout,
      doubleSided: { ...d.doubleSided },
      designRationale: d.rationale,
    })
    .where(eq(program.id, programId))
    .returning();
  if (!p) throw new Error("Program not found");
  const groups = await db().select().from(partnerGroup).where(eq(partnerGroup.programId, programId));
  for (const [rank, t] of d.tiers.entries()) {
    const existing = groups.find((g) => g.rank === rank);
    const values = {
      name: t.name,
      rank,
      commissionType: "percent" as const,
      commissionValue: d.commissionValue + t.bonusBps,
      promoteAtRevenue: t.promoteAtRevenue,
      isDefault: rank === 0,
    };
    if (existing) await db().update(partnerGroup).set(values).where(eq(partnerGroup.id, existing.id));
    else
      await db()
        .insert(partnerGroup)
        .values({ id: createId("grp"), programId, ...values });
  }
  await audit(
    p.workspaceId,
    actor,
    "program.design_applied",
    { type: "program", id: programId },
    { commissionValue: d.commissionValue, duration: d.commissionDuration },
  );
  return p;
}
