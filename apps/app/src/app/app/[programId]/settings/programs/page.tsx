import { Card, CardHeader } from "@openpromoter/ui";
import Link from "next/link";
import { programCtx, userPrograms } from "@/server/context";
import { DeleteProgram } from "./delete";
import { NewProgram } from "./new";

export default async function ProgramsPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { user, role, program: current } = await programCtx(programId);
  const programs = await userPrograms(user.id);
  return (
    <>
      <Card>
        <CardHeader
          title="Programs"
          description="Run several programs (for example per product or per brand) from one workspace."
        />
        <ul className="divide-y divide-border border-t border-border">
          {programs.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-5 py-3 text-[13px]">
              <Link href={`/app/${p.id}`} className="font-medium text-fg hover:underline">
                {p.name}
              </Link>
              <span className="text-xs text-subtle">
                {p.workspaceName} · {p.role}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {role === "owner" || role === "admin" ? <NewProgram programId={programId} /> : null}
      {role === "owner" ? <DeleteProgram programId={programId} name={current.name} /> : null}
    </>
  );
}
