import { bountySubmission, campaign, partner } from "@openpromoter/db";
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { contestStandings } from "@/server/campaigns";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { CampaignsView } from "./view";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { programId } = await params;
  const sp = await searchParams;
  const { program: prog, role } = await programCtx(programId);
  const rows = await db()
    .select()
    .from(campaign)
    .where(eq(campaign.programId, programId))
    .orderBy(desc(campaign.createdAt));
  const subs = await db()
    .select({
      s: bountySubmission,
      partnerName: partner.name,
      campaignName: campaign.name,
      reward: campaign.rule,
    })
    .from(bountySubmission)
    .innerJoin(campaign, eq(campaign.id, bountySubmission.campaignId))
    .innerJoin(partner, eq(partner.id, bountySubmission.partnerId))
    .where(eq(campaign.programId, programId))
    .orderBy(desc(bountySubmission.createdAt));
  const standings = Object.fromEntries(
    await Promise.all(
      rows
        .filter((c) => c.rule.kind === "contest" && c.status === "active")
        .map(
          async (c) =>
            [c.id, (await contestStandings(c, 5)).map((s) => ({ ...s, value: Number(s.value) }))] as const,
        ),
    ),
  );
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Bounties, contests and limited-time commission boosts. Describe it in one sentence; partners are notified when it goes live."
      />
      <CampaignsView
        programId={programId}
        currency={prog.currency}
        canWrite={role === "owner" || role === "admin"}
        autoFocus={sp.new === "1"}
        campaigns={rows.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          rule: c.rule,
          status: c.status,
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt?.toISOString() ?? null,
        }))}
        standings={standings}
        submissions={subs.map((x) => ({
          id: x.s.id,
          url: x.s.url,
          note: x.s.note,
          status: x.s.status,
          partnerName: x.partnerName,
          campaignName: x.campaignName,
          reward: x.reward.reward ?? 0,
        }))}
      />
    </>
  );
}
