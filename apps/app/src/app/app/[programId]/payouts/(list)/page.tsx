import { partner, payout } from "@openpromoter/db";
import { Badge, Button, Card, CardHeader } from "@openpromoter/ui";
import { BadgeCheck, Clock, Coins, Download, FileText, Wallet } from "@openpromoter/ui/icons";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader, Stat } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { payableBalances } from "@/server/ledger";
import { ApprovalQueue, PayoutHistory, PrepareButton } from "../client";

export const metadata: Metadata = { title: "Payouts" };

export default async function PayoutsPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: prog, role } = await programCtx(programId);
  const m = (n: number) => formatMoney(n, prog.currency);
  const mw = (n: number) => formatMoney(n, prog.currency, { whole: true });
  const canPay = ["owner", "admin", "finance"].includes(role);
  const [owed, queue, history, [paid]] = await Promise.all([
    payableBalances(programId),
    db()
      .select({
        po: payout,
        name: partner.name,
        email: partner.email,
        ready: partner.stripePayoutsEnabled,
        paypal: partner.paypalEmail,
        wise: partner.wiseEmail,
      })
      .from(payout)
      .innerJoin(partner, eq(partner.id, payout.partnerId))
      .where(
        and(
          eq(payout.programId, programId),
          inArray(payout.status, ["awaiting_approval", "processing", "failed"]),
        ),
      )
      .orderBy(desc(payout.amount)),
    db()
      .select({ po: payout, name: partner.name })
      .from(payout)
      .innerJoin(partner, eq(partner.id, payout.partnerId))
      .where(and(eq(payout.programId, programId), inArray(payout.status, ["paid", "canceled"])))
      .orderBy(desc(payout.createdAt))
      .limit(100),
    db()
      .select({
        total: sql<number>`coalesce(sum(${payout.amount}),0)::bigint`,
        n: sql<number>`count(*)::int`,
      })
      .from(payout)
      .where(and(eq(payout.programId, programId), eq(payout.status, "paid"))),
  ]);
  const owedTotal = owed.reduce((a, b) => a + b.approved, 0);
  const waiting = queue.filter((q) => q.po.status === "awaiting_approval");
  const year = new Date().getUTCFullYear();

  return (
    <>
      <PageHeader
        title="Payouts"
        description={`Partners owed at least ${m(prog.minPayout)} after the ${prog.holdDays}-day hold are paid ${prog.payoutSchedule === "manual" ? "when you click" : prog.payoutSchedule}. Nothing is sent until someone on your team approves it. No fees from us, ever.`}
        actions={
          <>
            <Button asChild variant="secondary">
              <a href={`/api/export/payouts?program=${programId}`}>
                <Download /> Export
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={`/api/export/1099?program=${programId}&year=${year - 1}`}>
                <FileText /> 1099 report {year - 1}
              </a>
            </Button>
            {canPay ? <PrepareButton programId={programId} disabled={owed.length === 0} /> : null}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Ready to pay"
          icon={Wallet}
          value={mw(owedTotal)}
          sub={`${owed.length} partner${owed.length === 1 ? "" : "s"} over the minimum`}
        />
        <Stat
          label="Waiting for approval"
          icon={Clock}
          value={mw(waiting.reduce((a, b) => a + b.po.amount, 0))}
          sub={`${waiting.length} payout${waiting.length === 1 ? "" : "s"}`}
        />
        <Stat
          label="Paid all time"
          icon={BadgeCheck}
          value={mw(Number(paid?.total ?? 0))}
          sub={`${paid?.n ?? 0} payouts`}
        />
        <Stat
          label="OpenPromoter fees"
          icon={Coins}
          value={mw(0)}
          sub="Provider fees (Stripe, PayPal, Wise) still apply"
        />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Approval queue"
          description={
            canPay
              ? "Review each payout before you approve it. Money moves only after this click."
              : "Only owners, admins and finance can approve payouts."
          }
          action={
            waiting.length ? (
              <Badge tone="warning" dot>
                {waiting.length} waiting
              </Badge>
            ) : null
          }
        />
        <ApprovalQueue
          programId={programId}
          canPay={canPay}
          readyCount={owed.length}
          rows={queue.map((q) => ({
            id: q.po.id,
            partnerId: q.po.partnerId,
            name: q.name,
            email: q.email,
            amount: q.po.amount,
            currency: q.po.currency,
            method: q.po.method,
            test: q.po.test,
            status: q.po.status,
            failureReason: q.po.failureReason,
            ready:
              q.po.method === "stripe"
                ? q.ready
                : q.po.method === "paypal"
                  ? !!q.paypal
                  : q.po.method === "wise"
                    ? !!q.wise
                    : true,
          }))}
        />
      </Card>

      <Card className="mt-6">
        <CardHeader title="History" />
        <PayoutHistory
          programId={programId}
          rows={history.map((h) => ({
            id: h.po.id,
            name: h.name,
            amount: h.po.amount,
            currency: h.po.currency,
            method: h.po.method,
            status: h.po.status,
            invoice: h.po.invoiceNumber,
            paidAt: h.po.paidAt?.toISOString() ?? null,
            externalId: h.po.externalId,
          }))}
        />
      </Card>
    </>
  );
}
