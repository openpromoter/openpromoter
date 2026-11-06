import { programCtx } from "@/server/context";
import { ImportForm } from "./form";

export default async function ImportPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p } = await programCtx(programId);
  return <ImportForm programId={programId} param={p.referralParam} />;
}
