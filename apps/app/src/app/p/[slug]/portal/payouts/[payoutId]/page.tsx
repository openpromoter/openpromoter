import { payout, workspace } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Invoice } from "@/lib/invoice";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";

export default async function PartnerInvoice({
  params,
}: {
  params: Promise<{ slug: string; payoutId: string }>;
}) {
  const { slug, payoutId } = await params;
  const { program: p, partner: pt } = await partnerCtx(slug);
  const [po] = await db()
    .select()
    .from(payout)
    .where(and(eq(payout.id, payoutId), eq(payout.partnerId, pt.id)));
  if (!po) notFound();
  const [ws] = await db().select().from(workspace).where(eq(workspace.id, p.workspaceId));
  return <Invoice po={po} pt={pt} prog={p} workspaceName={ws?.name ?? p.name} />;
}
