import type { Metadata } from "next";
import { aiEnabled } from "@/server/ai/provider";
import { programCtx } from "@/server/context";
import { AssistantView } from "./view";

export const metadata: Metadata = { title: "Ask AI" };

export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { programId } = await params;
  const sp = await searchParams;
  const { program, user } = await programCtx(programId);
  return (
    <>
      <h1 className="sr-only">Ask AI</h1>
      <AssistantView
        programId={programId}
        initial={sp.q ?? ""}
        ai={aiEnabled()}
        programName={program.name}
        firstName={user.name.split(" ")[0] ?? ""}
      />
    </>
  );
}
