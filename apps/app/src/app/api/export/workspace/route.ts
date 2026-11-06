import {
  auditLog,
  campaign,
  click,
  commission,
  member,
  partner,
  payout,
  program,
  referral,
  user,
} from "@openpromoter/db";
import { and, eq, inArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { AccessError, requireWorkspace } from "@/server/access";
import { currentUser } from "@/server/context";
import { db } from "@/server/db";
import { jsonStream, keyset } from "@/server/exports";

/** Full data export for a workspace (owners only): take your data and leave, no form to fill. */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return new Response("Sign in", { status: 401 });
  const wsId = new URL(req.url).searchParams.get("workspace") ?? "";
  try {
    await requireWorkspace(u.id, wsId, "billing.write");
  } catch (e) {
    return new Response((e as Error).message, { status: e instanceof AccessError ? e.status : 500 });
  }
  const programs = await db().select().from(program).where(eq(program.workspaceId, wsId));
  const ids = programs.map((p) => p.id).concat("none");
  // streamed table by table, 5,000 rows at a time: a 1M-row workspace never sits in memory as one string
  const pages = <T extends { createdAt: PgColumn; id: PgColumn }>(
    t: T & PgTable,
    programCol: PgColumn,
    cap = Infinity,
  ) =>
    async function* () {
      let n = 0;
      for await (const page of keyset(
        t,
        (after, order, size) =>
          db()
            .select()
            .from(t as PgTable)
            .where(and(inArray(programCol, ids), after))
            .orderBy(...order)
            .limit(size) as Promise<Record<string, unknown>[]>,
        (r) => r as { createdAt: Date; id: string },
      )) {
        yield page.slice(0, Math.max(0, cap - n));
        n += page.length;
        if (n >= cap) return;
      }
    };
  return jsonStream(`openpromoter-${wsId}.json`, [
    ["exportedAt", new Date().toISOString()],
    ["programs", programs],
    [
      "team",
      await db()
        .select({ email: user.email, name: user.name, role: member.role })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.workspaceId, wsId)),
    ],
    [
      "partners",
      async function* () {
        for await (const page of pages(partner, partner.programId)())
          yield page.map(({ taxIdEnc, ...p }) => ({ ...p, taxIdOnFile: !!taxIdEnc }));
      },
    ],
    ["referrals", pages(referral, referral.programId)],
    ["commissions", pages(commission, commission.programId)],
    ["payouts", pages(payout, payout.programId)],
    ["campaigns", pages(campaign, campaign.programId)],
    ["clicks", pages(click, click.programId, 1_000_000)],
    ["auditLog", await db().select().from(auditLog).where(eq(auditLog.workspaceId, wsId))],
  ]);
}
