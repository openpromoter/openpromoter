import { commission, fraudFlag, partner } from "@openpromoter/db";
import { Card, CardBody, CardHeader } from "@openpromoter/ui";
import { Flag, PauseCircle, ShieldAlert } from "@openpromoter/ui/icons";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader, Stat } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { SIGNAL_LABELS } from "@/server/fraud";
import { baseAmount } from "@/server/fx";
import { FraudView } from "./view";

export const metadata: Metadata = { title: "Fraud" };

export default async function FraudPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: prog, role } = await programCtx(programId);
  const [flags, [held], [risky]] = await Promise.all([
    db()
      .select({
        f: fraudFlag,
        name: partner.name,
        email: partner.email,
        riskScore: partner.riskScore,
        status: partner.status,
      })
      .from(fraudFlag)
      .innerJoin(partner, eq(partner.id, fraudFlag.partnerId))
      .where(eq(fraudFlag.programId, programId))
      .orderBy(desc(fraudFlag.createdAt))
      .limit(200),
    db()
      .select({
        n: sql<number>`count(*)::int`,
        sum: sql<number>`coalesce(sum(${baseAmount}),0)::bigint`,
      })
      .from(commission)
      .where(and(eq(commission.programId, programId), eq(commission.status, "held"))),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(partner)
      .where(and(eq(partner.programId, programId), sql`${partner.riskScore} >= ${prog.fraudHoldScore}`)),
  ]);
  return (
    <>
      <PageHeader
        title="Fraud"
        description={`Every referral and partner is scored. Commissions from partners or referrals scoring ${prog.fraudHoldScore} or more are held automatically until you decide.`}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat icon={Flag} label="Open flags" value={flags.filter((f) => f.f.resolution === "open").length} />
        <Stat
          icon={PauseCircle}
          label="Held commissions"
          value={formatMoney(Number(held?.sum ?? 0), prog.currency)}
          sub={`${held?.n ?? 0} commissions`}
        />
        <Stat
          icon={ShieldAlert}
          label="High-risk partners"
          value={risky?.n ?? 0}
          className="col-span-2 lg:col-span-1"
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FraudView
            programId={programId}
            canWrite={role === "owner" || role === "admin"}
            flags={flags.map((x) => ({
              id: x.f.id,
              partnerId: x.f.partnerId,
              name: x.name,
              email: x.email,
              signal: SIGNAL_LABELS[x.f.signal as keyof typeof SIGNAL_LABELS] ?? x.f.signal,
              score: x.f.score,
              detail: x.f.detail,
              resolution: x.f.resolution,
              createdAt: x.f.createdAt.toISOString(),
            }))}
          />
        </div>
        <Card className="h-fit">
          <CardHeader title="What we check" />
          <CardBody>
            <ul className="flex flex-col gap-2 text-[13px] text-muted">
              {Object.values(SIGNAL_LABELS).map((l) => (
                <li key={l} className="flex gap-2">
                  <span className="text-subtle" aria-hidden>
                    •
                  </span>
                  {l}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-subtle">
              Hold threshold and rules live in Settings &gt; Program.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
