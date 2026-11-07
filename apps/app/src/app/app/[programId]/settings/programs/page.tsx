import { Badge, Card, CardHeader } from "@openpromoter/ui";
import Link from "next/link";
import { programCtx, userPrograms } from "@/server/context";
import { DeleteProgram } from "./delete";
import { NewProgram } from "./new";

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function ProgramsPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { user, role, program: current } = await programCtx(programId);
  const programs = await userPrograms(user.id);
  return (
    <>
      <Card>
        <CardHeader
          title="Programs"
          description="Run several programs (for example per product or per brand) from one workspace. Open one to manage or delete it."
        />
        <ul className="divide-y divide-border border-t border-border">
          {programs.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                {p.id === programId ? (
                  <span className="truncate font-medium text-fg">{p.name}</span>
                ) : (
                  <Link
                    href={`/app/${p.id}/settings/programs`}
                    className="truncate font-medium text-fg hover:underline"
                  >
                    {p.name}
                  </Link>
                )}
                {p.id === programId ? <Badge tone="primary">Current</Badge> : null}
              </span>
              <span className="shrink-0 text-xs text-subtle">
                Created {day(p.createdAt)} · {p.workspaceName} · {p.role}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {role === "owner" || role === "admin" ? <NewProgram programId={programId} /> : null}
      {role === "owner" ? (
        <DeleteProgram programId={programId} name={current.name} created={day(current.createdAt)} />
      ) : null}
    </>
  );
}
