import { programCtx } from "@/server/context";
import { programUrl } from "@/server/ref-link";
import { ApplicationForm } from "./form";

export default async function ApplicationSettings({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p, role } = await programCtx(programId);
  return (
    <ApplicationForm
      programId={programId}
      canWrite={role === "owner" || role === "admin"}
      questions={p.applicationQuestions}
      autoApprove={p.autoApprove}
      applyUrl={programUrl(p, "/apply")}
    />
  );
}
