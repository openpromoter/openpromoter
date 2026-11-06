import { auditLog, user } from "@openpromoter/db";
import { Badge, Button, Card, CardHeader } from "@openpromoter/ui";
import { Download } from "@openpromoter/ui/icons";
import { desc, eq } from "drizzle-orm";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";

export default async function AuditPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p } = await programCtx(programId);
  const rows = await db()
    .select({ a: auditLog, name: user.name })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(eq(auditLog.workspaceId, p.workspaceId))
    .orderBy(desc(auditLog.createdAt))
    .limit(300);
  return (
    <Card>
      <CardHeader
        title="Audit log"
        description="Every change to money, partners, permissions and settings. Kept for the life of the workspace."
        action={
          <Button asChild size="sm">
            <a href={`/api/export/audit?program=${programId}`}>
              <Download /> Export
            </a>
          </Button>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-border bg-surface-2 text-xs text-muted">
              <th className="px-5 py-2 text-left font-medium">When</th>
              <th className="px-3 py-2 text-left font-medium">Who</th>
              <th className="px-3 py-2 text-left font-medium">Action</th>
              <th className="px-5 py-2 text-left font-medium">Target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, name }) => (
              <tr key={a.id} className="border-b border-border">
                <td className="px-5 py-2 whitespace-nowrap text-muted">
                  {a.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    tone={a.actorType === "ai" ? "primary" : a.actorType === "user" ? "neutral" : "info"}
                  >
                    {a.actorType}
                  </Badge>{" "}
                  <span className="text-fg">{name ?? ""}</span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-fg">{a.action}</td>
                <td className="px-5 py-2 font-mono text-xs text-subtle">
                  {a.targetType ? `${a.targetType}:${a.targetId}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
