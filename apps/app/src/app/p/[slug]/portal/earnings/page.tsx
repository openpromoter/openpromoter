import { commission } from "@openpromoter/db";
import { Button, Card, CardBody, CardHeader, EmptyState, StatusBadge } from "@openpromoter/ui";
import { ChevronLeft, ChevronRight, Coins, Download } from "@openpromoter/ui/icons";
import { desc, eq } from "drizzle-orm";
import { DotChart } from "@/components/charts";
import { LedgerLine, PageHeader } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";
import { balanceAcross, balances, mainBalance, moneyAcross } from "@/server/ledger";
import { timeseriesForPartner } from "@/server/partner-stats";
import { programBase } from "@/server/program-base";

const PER_PAGE = 50;

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function PortalEarnings({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const { program: p, partner: pt } = await partnerCtx(slug);
  const home = await programBase(p);
  const [rows, series, bal] = await Promise.all([
    db()
      .select()
      .from(commission)
      .where(eq(commission.partnerId, pt.id))
      .orderBy(desc(commission.createdAt), desc(commission.id))
      // one extra row tells us whether an Older page exists
      .limit(PER_PAGE + 1)
      .offset((page - 1) * PER_PAGE),
    timeseriesForPartner(pt.id, 60),
    balances(p.id, [pt.id]),
  ]);
  // one balance per currency: the program's own first, then any currency a customer paid in
  const cards = [
    mainBalance(bal, p.currency),
    ...bal.filter((x) => x.currency !== p.currency && x.pending + x.approved + x.held + x.paid !== 0),
  ];
  const m = (n: number, c = p.currency) => (n < 0 ? `−${formatMoney(-n, c)}` : formatMoney(n, c));
  const hasOlder = rows.length > PER_PAGE;
  const lines = rows.slice(0, PER_PAGE).filter((r) => r.amount !== 0);
  const pageHref = (n: number) => (n > 1 ? `?page=${n}` : "?");
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
            You've earned{" "}
            <b className="font-medium text-fg">
              {balanceAcross(bal, p.currency, (x) => x.pending + x.approved + x.held + x.paid)}
            </b>{" "}
            with {p.name}, and{" "}
            <b className="font-medium text-fg">{balanceAcross(bal, p.currency, (x) => x.paid)}</b> of it is
            already paid.
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
        <div className="flex flex-col gap-4">
          {cards.map((b, i) => (
            <Card key={b.currency} className="flex flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <span className="eyebrow">Balance</span>
                <span className="eyebrow">{b.currency.toUpperCase()}</span>
              </div>
              <div className="flex flex-1 flex-col gap-3 px-5 py-4">
                <LedgerLine label="Pending" value={m(b.pending, b.currency)} />
                <LedgerLine label="Approved" value={m(b.approved, b.currency)} />
                <LedgerLine label="On hold" value={m(b.held, b.currency)} />
                <LedgerLine label="Paid out" value={m(b.paid, b.currency)} />
                {i === 0 ? (
                  <p className="text-xs leading-4 text-subtle">
                    Pending clears after the {p.holdDays}-day refund window and joins the next payout.
                  </p>
                ) : null}
                <div className="mt-auto border-t border-border-strong pt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] font-medium text-fg">Total earned</span>
                    <span className="figure text-[24px] leading-8 text-fg">
                      {m(b.pending + b.approved + b.held + b.paid, b.currency)}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Statement"
          description="Every commission with the newest first."
          action={
            <Button asChild size="sm">
              <a href={`${home}/portal/earnings/csv`}>
                <Download /> Download CSV
              </a>
            </Button>
          }
        />
        {lines.length ? (
          <div className="border-t border-border">
            {[...months].map(([month, items]) => (
              <section key={month}>
                <div className="flex h-9 items-center justify-between border-b border-border bg-surface-2 px-5">
                  <span className="eyebrow">{month}</span>
                  <span className="num text-[12px] text-muted">
                    {moneyAcross(
                      [...new Set(items.map((r) => r.currency))].map((c) => ({
                        currency: c,
                        n: items.reduce(
                          (s, r) => s + (r.status === "reversed" || r.currency !== c ? 0 : r.amount),
                          0,
                        ),
                      })),
                      p.currency,
                    )}
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {items.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                      <time className="w-12 shrink-0 num text-[12px] text-subtle">{day(r.createdAt)}</time>
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
            {page > 1 || hasOlder ? (
              <nav
                aria-label="Statement pages"
                className="flex items-center justify-between border-t border-border px-5 py-3"
              >
                <span className="text-[13px] text-muted">Page {page}</span>
                <span className="flex gap-2">
                  {page > 1 ? (
                    <Button asChild size="sm" variant="secondary">
                      <a href={pageHref(page - 1)}>
                        <ChevronLeft /> Newer
                      </a>
                    </Button>
                  ) : null}
                  {hasOlder ? (
                    <Button asChild size="sm" variant="secondary">
                      <a href={pageHref(page + 1)}>
                        Older <ChevronRight />
                      </a>
                    </Button>
                  ) : null}
                </span>
              </nav>
            ) : null}
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
