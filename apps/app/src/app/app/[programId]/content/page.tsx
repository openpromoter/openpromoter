import { contentAsset, resource } from "@openpromoter/db";
import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { aiEnabled } from "@/server/ai/provider";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { ContentView } from "./view";

export const metadata: Metadata = { title: "Content kit" };

export default async function ContentPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { role } = await programCtx(programId);
  const [assets, resources] = await Promise.all([
    db()
      .select()
      .from(contentAsset)
      .where(eq(contentAsset.programId, programId))
      .orderBy(asc(contentAsset.kind), asc(contentAsset.createdAt)),
    db()
      .select({
        id: resource.id,
        title: resource.title,
        url: resource.url,
        description: resource.description,
        fileName: resource.fileName,
      })
      .from(resource)
      .where(eq(resource.programId, programId))
      .orderBy(asc(resource.createdAt)),
  ]);
  return (
    <>
      <PageHeader
        title="Content kit"
        description="Copy, posts, emails and banners your partners can use straight away. Generated from your website and refreshed when your site changes. Partners see it with their own link filled in."
      />
      <ContentView
        programId={programId}
        canWrite={role === "owner" || role === "admin"}
        ai={aiEnabled()}
        assets={assets.map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          body: a.body,
          meta: a.meta,
          by: a.generatedBy,
        }))}
        resources={resources.map((r) => ({
          id: r.id,
          title: r.title,
          url: r.url,
          fileName: r.fileName,
          description: r.description,
        }))}
      />
    </>
  );
}
