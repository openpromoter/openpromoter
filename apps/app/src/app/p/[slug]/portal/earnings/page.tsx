import { commission } from "@openpromoter/db";
import { Card, CardBody, CardHeader, EmptyState, StatusBadge } from "@openpromoter/ui";
import { Coins } from "@openpromoter/ui/icons";
import { desc, eq } from "drizzle-orm";
import { DotChart } from "@/components/charts";
import { LedgerLine, PageHeader } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";
import { balances } from "@/server/ledger";
import { timeseriesForPartner } from "@/server/partner-stats";

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });

export default async function PortalEarnings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program: p, partner: pt } = await partnerCtx(slug);
  const [rows, series, bal] = await Promise.all([
    db()
      .select()
      .from(commission)
      .where(eq(commission.partnerId, pt.id))
      .orderBy(desc(commission.createdAt))
      .limit(200),
    timeseriesForPartner(pt.id, 60),
    balances(p.id, [pt.id]),
  ]);
  const b = bal.find((x) => x.currency === p.currency) ?? { approved: 0, pending: 0, held: 0, paid: 0 };
  const m = (n: number, c = p.currency) => (n < 0 ? `−${formatMoney(-n, c)}` : formatMoney(n, c));
  const total = b.pending + b.approved + b.held + b.paid;
  const lines = rows.filter((r) => r.amount !== 0);
  const months = new Map<string, typeof lines>();
  for (const r of lines) {
    const k = r.createdAt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    months.set(k, [...(months.get(k) ?? []), r]);
  }
  return (
    <>
      <PageHeader
        title="Earnings"
        description={
          <>
            You've earned <b className="font-medium text-fg">{m(total)}</b> with {p.name}, and{" "}
            <b className="font-medium text-fg">{m(b.paid)}</b> of it is already paid.
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <CardHeader title="Daily earnings" description="Last 60 days with refunds already taken off." />
          <CardBody>
            <DotChart
              data={series}
              x="date"
              kind="money"
              currency={p.currency}
              series={[{ key: "earned", name: "Earned" }]}
              label="Daily earnings over the last 60 days"
              height={200}
            />
          </CardBody>
        </Card>
        <Card className="flex flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="eyebrow">Balance</span>
            <span className="eyebrow">{p.currency}</span>
          </div>
          <div className="flex flex-1 flex-col gap-3 px-5 py-4">
            <LedgerLine label="Pending" value={m(b.pending)} />
            <LedgerLine label="Approved" value={m(b.approved)} />
            <LedgerLine label="On hold" value={m(b.held)} />
            <LedgerLine label="Paid out" value={m(b.paid)} />
            <p className="text-xs leading-4 text-subtle">
              Pending clears after the {p.holdDays}-day refund window and joins the next payout.
            </p>
            <div className="mt-auto border-t border-border-strong pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium text-fg">Total earned</span>
                <span className="figure text-[24px] leading-8 text-fg">{m(total)}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Statement" description="Every commission with the newest first." />
        {lines.length ? (
          <div className="border-t border-border">
            {[...months].map(([month, items]) => (
              <section key={month}>
                <div className="flex h-9 items-center justify-between border-b border-border bg-surface-2 px-5">
                  <span className="eyebrow">{month}</span>
                  <span className="num font-mono text-[12px] text-muted">
                    {m(items.reduce((s, r) => s + (r.status === "reversed" ? 0 : r.amount), 0))}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {items.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                      <time className="w-12 shrink-0 font-mono text-[12px] text-subtle">
                        {day(r.createdAt)}
                      </time>
                      <span className="flex min-w-0 flex-1 items-baseline">
                        <span className="min-w-0 truncate text-fg">
                          {r.description ?? r.kind}
                          {r.status === "pending" && r.holdUntil ? (
                            <span className="text-subtle"> · payable from {day(r.holdUntil)}</span>
                          ) : null}
                        </span>
                        <span className="leader hidden sm:block" aria-hidden />
                      </span>
                      <span className="hidden sm:inline-flex">
                        <StatusBadge status={r.status} />
                      </span>
                      <span
                        className={`num w-24 shrink-0 text-right font-medium ${r.amount < 0 || r.status === "reversed" ? "text-danger" : "text-fg"}`}
                      >
                        {m(r.amount, r.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Coins}
            title="No earnings yet"
            description="The commission lands here within seconds each time someone you referred pays."
            className="border-t border-border"
          />
        )}
      </Card>
    </>
  );
}
