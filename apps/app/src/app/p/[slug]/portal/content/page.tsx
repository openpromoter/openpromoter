import { campaign, contentAsset, link, resource } from "@openpromoter/db";
import { and, asc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/page";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { PartnerContent } from "./client";

export default async function PortalContent({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ bounty?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { program: p, partner: pt } = await partnerCtx(slug);
  const [assets, resources, [l], bounties] = await Promise.all([
    db().select().from(contentAsset).where(eq(contentAsset.programId, p.id)).orderBy(asc(contentAsset.kind)),
    db()
      .select({
        id: resource.id,
        title: resource.title,
        url: resource.url,
        description: resource.description,
        fileName: resource.fileName,
      })
      .from(resource)
      .where(eq(resource.programId, p.id)),
    // the first link is the partner's main one; deep links made later never replace it
    db()
      .select()
      .from(link)
      .where(eq(link.partnerId, pt.id))
      .orderBy(asc(link.createdAt), asc(link.id))
      .limit(1),
    db()
      .select()
      .from(campaign)
      .where(and(eq(campaign.programId, p.id), eq(campaign.status, "active"))),
  ]);
  const myLink = l ? `${env.APP_URL}/r/${slug}/l/${l.key}` : `${env.APP_URL}/r/${slug}/${pt.code}`;
  return (
    <>
      <PageHeader
        title="Content kit"
        description="Posts, emails and banners ready to share. Your link is already filled in."
      />
      <PartnerContent
        slug={slug}
        assets={assets.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          body: a.body.replaceAll("{{link}}", myLink),
        }))}
        resources={resources.map((r) => ({
          id: r.id,
          title: r.title,
          url: r.url,
          fileName: r.fileName,
          description: r.description,
        }))}
        bounties={bounties
          .filter((b) => b.rule.kind === "bounty" && b.rule.trigger === "post")
          .map((b) => ({ id: b.id, name: b.name, reward: b.rule.reward ?? 0 }))}
        currency={p.currency}
        focusBounty={sp.bounty ?? null}
      />
    </>
  );
}
