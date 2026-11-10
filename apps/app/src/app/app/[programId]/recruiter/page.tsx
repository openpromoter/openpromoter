import { prospect } from "@openpromoter/db";
import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { aiProvider } from "@/server/ai/provider";
import { inviteUrl } from "@/server/ai/recruiter";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { RecruiterView } from "./view";

export const metadata: Metadata = { title: "Recruiter" };

export default async function RecruiterPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { role, program: prog } = await programCtx(programId);
  const rows = await db()
    .select()
    .from(prospect)
    .where(eq(prospect.programId, programId))
    .orderBy(desc(prospect.score))
    .limit(300);
  return (
    <RecruiterView
      description="Your best partners are usually your happiest customers. The recruiter ranks them from Stripe, finds creators in your niche and drafts a personal invite you send from your own email."
      programId={programId}
      canWrite={role === "owner" || role === "admin"}
      webSearch={aiProvider() === "anthropic"}
      rows={rows.map((r) => ({
        id: r.id,
        source: r.source,
        name: r.name,
        email: r.email,
        url: r.url,
        reason: r.reason,
        score: r.score,
        subject: r.inviteSubject ?? "",
        body: r.inviteBody ?? "",
        status: r.status,
        sentAt: r.sentAt?.toISOString() ?? null,
        inviteUrl: inviteUrl(prog, r),
      }))}
    />
  );
}
