import { agentAction, fraudFlag, partner, payout, workspace } from "@openpromoter/db";
import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { DemoBanner } from "@/components/demo-banner";
import { AppShell } from "@/components/shell/app-shell";
import { isAdmin } from "@/server/admin";
import { programCtx, userPrograms } from "@/server/context";
import { db } from "@/server/db";
import { isDemoUser } from "@/server/demo";

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
  const [pending, suggestions, payouts, flags, [ws]] = await Promise.all([
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
    db()
      .select({ status: workspace.billingStatus })
      .from(workspace)
      .where(eq(workspace.id, ctx.program.workspaceId)),
  ]);
  // a failed renewal is easy to miss on the billing page alone: owners see it on every page until it is fixed
  const failed = ws?.status === "past_due" && ctx.role === "owner";
  return (
    <AppShell
      program={{
        id: ctx.program.id,
        name: ctx.program.name,
        slug: ctx.program.slug,
        color: ctx.program.brand.color,
      }}
      programs={programs.map((p) => ({ id: p.id, name: p.name, workspaceName: p.workspaceName }))}
      user={{ name: ctx.user.name, email: ctx.user.email, admin: isAdmin(ctx.user) }}
      role={ctx.role}
      counts={{ partners: pending, autopilot: suggestions, payouts, fraud: flags }}
    >
      {isDemoUser(ctx.user) ? <DemoBanner className="mb-6" /> : null}
      {failed ? (
        <p className="mb-6 rounded-lg border border-border bg-warning-soft px-4 py-3 text-[13px] text-warning">
          Your last payment didn't go through. Stripe will try again.{" "}
          <Link href={`/app/${programId}/settings/billing`} className="font-medium underline">
            Update your card
          </Link>{" "}
          to keep your plan.
        </p>
      ) : null}
      {children}
    </AppShell>
  );
}
