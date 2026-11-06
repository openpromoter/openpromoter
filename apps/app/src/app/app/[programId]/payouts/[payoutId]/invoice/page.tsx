import { partner, payout } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Invoice } from "@/lib/invoice";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { PrintButton } from "./print";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ programId: string; payoutId: string }>;
}) {
  const { programId, payoutId } = await params;
  const { program: prog, workspace } = await programCtx(programId);
  const [row] = await db()
    .select({ po: payout, pt: partner })
    .from(payout)
    .innerJoin(partner, eq(partner.id, payout.partnerId))
    .where(and(eq(payout.id, payoutId), eq(payout.programId, programId)));
  if (!row) notFound();
  return (
    <div>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <Invoice po={row.po} pt={row.pt} prog={prog} workspaceName={workspace.name} />
    </div>
  );
}
