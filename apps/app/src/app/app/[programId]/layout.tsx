import { agentAction, fraudFlag, partner, payout } from "@openpromoter/db";
import { and, eq, sql } from "drizzle-orm";
import { AppShell } from "@/components/shell/app-shell";
import { programCtx, userPrograms } from "@/server/context";
import { db } from "@/server/db";

export default async function ProgramLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const ctx = await programCtx(programId);
  const programs = await userPrograms(ctx.user.id);
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [pending, suggestions, payouts, flags] = await Promise.all([
    count(
      db()
        .select({ n: sql<number>`count(*)::int` })
        .from(partner)
        .where(and(eq(partner.programId, programId), eq(partner.status, "pending"))),
    ),
    count(
      db()
        .select({ n: sql<number>`count(*)::int` })
        .from(agentAction)
        .where(and(eq(agentAction.programId, programId), eq(agentAction.status, "suggested"))),
    ),
    count(
      db()
        .select({ n: sql<number>`count(*)::int` })
        .from(payout)
        .where(and(eq(payout.programId, programId), eq(payout.status, "awaiting_approval"))),
    ),
    count(
      db()
        .select({ n: sql<number>`count(*)::int` })
        .from(fraudFlag)
        .where(and(eq(fraudFlag.programId, programId), eq(fraudFlag.resolution, "open"))),
    ),
  ]);
  return (
    <AppShell
      program={{
        id: ctx.program.id,
        name: ctx.program.name,
        slug: ctx.program.slug,
        color: ctx.program.brand.color,
      }}
      programs={programs.map((p) => ({ id: p.id, name: p.name, workspaceName: p.workspaceName }))}
      user={{ name: ctx.user.name, email: ctx.user.email }}
      role={ctx.role}
      counts={{ partners: pending, autopilot: suggestions, payouts, fraud: flags }}
    >
      {children}
    </AppShell>
  );
}
