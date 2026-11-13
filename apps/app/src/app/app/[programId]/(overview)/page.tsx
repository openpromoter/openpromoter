import { agentAction, billingConnection, commission, partner, payout, referral } from "@openpromoter/db";
import { Avatar, Badge, Button, cn, EmptyState, StatusBadge } from "@openpromoter/ui";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Clock,
  Coins,
  Expand,
  PauseCircle,
  Receipt,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  TrendDown,
  TrendUp,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from "@openpromoter/ui/icons";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { BarSpark, DotChart, DotSpark } from "@/components/charts";
import { RangePicker } from "@/components/range-picker";
import { formatMoney, formatNumber, formatPercent } from "@/lib/money";
import { delta, overview, parseRange, previous, timeseries, topPartners } from "@/server/analytics";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { baseAmount } from "@/server/fx";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The board's columns, in the order money moves. Same outline glyphs and quiet count chips as the
 * Commissions board, so a stage reads by its icon and label in both places.
 */
const COLUMNS = [
  { status: "held", label: "Held for review", icon: PauseCircle },
  { status: "pending", label: "Refund window", icon: Clock },
  { status: "approved", label: "Ready to pay", icon: BadgeCheck },
  { status: "paid", label: "Paid", icon: Receipt },
] as const;

const KIND: Record<string, string> = {
  sale: "Sale",
  lead: "Lead",
  bounty: "Bounty",
  bonus: "Bonus",
  adjustment: "Adjustment",
  override: "Recruiter override",
};

export default async function Dashboard({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { programId } = await params;
  const sp = await searchParams;
  const { program: prog, user } = await programCtx(programId);
  const days = Number(sp.days ?? 30) || 30;
  const range = parseRange({ days: String(days) });
  const base = `/app/${programId}`;
  const m = (n: number, c = prog.currency) => formatMoney(n, c);
  const mw = (n: number) => formatMoney(n, prog.currency, { whole: true });

  const cardsFor = (status: (typeof COLUMNS)[number]["status"]) =>
    db()
      .select({ c: commission, name: partner.name, avatar: partner.avatarUrl, customer: referral.email })
      .from(commission)
      .innerJoin(partner, eq(partner.id, commission.partnerId))
      .leftJoin(referral, eq(referral.id, commission.referralId))
      .where(
        and(
          eq(commission.programId, programId),
          eq(commission.status, status),
          sql`${commission.amount} <> 0`,
        ),
      )
      .orderBy(desc(commission.createdAt))
      .limit(2);

  const [
    cur,
    prev,
    series,
    prevSeries,
    top,
    suggestions,
    waitingPayouts,
    pendingApps,
    conn,
    partnerCount,
    totals,
    ...board
  ] = await Promise.all([
    overview(programId, range),
    overview(programId, previous(range)),
    timeseries(programId, range),
    timeseries(programId, previous(range)),
    topPartners(programId, range, 5),
    db()
      .select()
      .from(agentAction)
      .where(and(eq(agentAction.programId, programId), eq(agentAction.status, "suggested")))
      .orderBy(desc(agentAction.impact), desc(agentAction.createdAt))
      .limit(3),
    db()
      .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${payout.amount}),0)::int` })
      .from(payout)
      .where(and(eq(payout.programId, programId), eq(payout.status, "awaiting_approval"))),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(partner)
      .where(and(eq(partner.programId, programId), eq(partner.status, "pending"))),
    db().select().from(billingConnection).where(eq(billingConnection.workspaceId, prog.workspaceId)),
    db().select({ n: sql<number>`count(*)::int` }).from(partner).where(eq(partner.programId, programId)),
    db()
      .select({
        status: commission.status,
        n: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${baseAmount}),0)::bigint`,
      })
      .from(commission)
      .where(and(eq(commission.programId, programId), sql`${commission.amount} <> 0`))
      .groupBy(commission.status),
    ...COLUMNS.map((c) => cardsFor(c.status)),
  ]);
  const setup = [
    {
      done: conn.some((c) => !!c.webhookSecretEnc || c.mode === "oauth"),
      label: "Connect billing",
      href: `${base}/settings/integrations`,
    },
    {
      done: !!prog.designRationale,
      label: "Accept program design",
      href: `/onboarding?program=${programId}&step=3`,
    },
    { done: !!prog.installVerifiedAt, label: "Install tracking", href: `${base}/settings/install` },
    { done: (partnerCount[0]?.n ?? 0) > 0, label: "Invite partners", href: `${base}/recruiter` },
  ];
  const setupLeft = setup.filter((s) => !s.done).length;
  const waiting = waitingPayouts[0] ?? { n: 0, total: 0 };
  const needs = [
    waiting.n
      ? {
          icon: Banknote,
          title: `Approve ${waiting.n} payout${waiting.n === 1 ? "" : "s"}`,
          meta: m(waiting.total),
          href: `${base}/payouts`,
        }
      : null,
    pendingApps[0]?.n
      ? {
          icon: UserPlus,
          title: `Review ${pendingApps[0].n} application${pendingApps[0].n === 1 ? "" : "s"}`,
          meta: "Partners",
          href: `${base}/partners?status=pending`,
        }
      : null,
    cur.held
      ? {
          icon: PauseCircle,
          title: "Held commissions",
          meta: m(cur.held),
          href: `${base}/commissions?status=held`,
        }
      : null,
    ...suggestions.map((x) => ({
      icon: Sparkles,
      title: x.title,
      meta: "Autopilot",
      href: `${base}/autopilot#${x.id}`,
    })),
  ].filter(Boolean) as { icon: typeof Banknote; title: string; meta: string; href: string }[];

  const tail = series.slice(-28);
  const recent = Math.min(7, tail.length);
  const dRev = delta(cur.revenue, prev.revenue);
  const dCom = delta(cur.commissions, prev.commissions);
  const dCust = delta(cur.customers, prev.customers);
  const dConv = delta(cur.conversionRate, prev.conversionRate);
  const nextSetup = setup.find((x) => !x.done);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const balance = cur.owed + cur.pending + cur.held;
  const active = top.filter((t) => t.revenue > 0 || t.clicks > 0);
  const firstName = (user.name ?? "").split(" ")[0] || "there";
  return (
    <>
      <AutoRefresh />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-subtle">
            {greeting}, {firstName}
          </p>
          <h1 className="mt-0.5 text-[22px] leading-7 font-medium tracking-[-0.02em] text-fg">
            {prog.name} overview
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker days={days} base={base} />
          <Button asChild variant="primary">
            <Link href={`${base}/recruiter`}>
              <UserPlus /> Invite partners
            </Link>
          </Button>
        </div>
      </header>

      {nextSetup ? (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3 ">
          <div className="flex items-center gap-3">
            <div className="flex gap-1" aria-hidden>
              {setup.map((x) => (
                <span
                  key={x.label}
                  className={cn("h-1.5 w-6 rounded-[1px]", x.done ? "bg-accent" : "bg-surface-3")}
                />
              ))}
            </div>
            <span className="text-[13px] text-fg">
              Finish setup <span className="num text-subtle">· {4 - setupLeft} of 4 done</span>
            </span>
          </div>
          <span className="hidden text-[13px] text-subtle sm:inline">
            Next: {nextSetup.label.toLowerCase()}
          </span>
          <Button asChild variant="secondary" size="sm" className="ml-auto">
            <Link href={nextSetup.href}>
              {nextSetup.label} <ArrowRight />
            </Link>
          </Button>
        </div>
      ) : null}

      <section
        aria-label="Key numbers"
        className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-surface xl:grid-cols-4"
      >
        <Metric
          icon={Coins}
          label="Referred revenue"
          d={dRev}
          value={mw(cur.revenue)}
          caption={`${mw(cur.mrr)} MRR from partners`}
        >
          <DotSpark values={tail.map((x) => x.revenue)} recent={recent} rows={5} />
        </Metric>
        <Metric
          icon={Wallet}
          label="Partners earned"
          d={dCom}
          value={mw(cur.commissions)}
          caption={`${formatNumber(cur.activePartners)} active partners`}
        >
          <BarSpark values={tail.map((x) => x.commissions)} recent={recent} />
        </Metric>
        <Metric
          icon={UserPlus}
          label="New customers"
          d={dCust}
          value={formatNumber(cur.customers)}
          caption={`from ${formatNumber(cur.clicks)} human clicks`}
        >
          <DotSpark values={tail.map((x) => x.customers)} recent={recent} rows={5} />
        </Metric>
        <Metric
          icon={Target}
          label="Conversion"
          d={dConv}
          value={formatPercent(cur.conversionRate, 2)}
          caption={`EPC ${m(Math.round(cur.epc))} per click`}
        >
          <BarSpark values={tail.map((x) => (x.clicks ? x.customers / x.clicks : 0))} recent={recent} />
        </Metric>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-medium tracking-[-0.01em] text-fg">Performance</h2>
              <p className="text-xs text-subtle">
                Daily totals for the last {days} days against the {days} days before
              </p>
            </div>
            <Link
              href={`${base}/analytics`}
              className="flex items-center gap-1 text-[13px] text-muted hover:text-fg"
            >
              Analytics <ArrowUpRight size={13} />
            </Link>
          </div>
          <div className="mt-4">
            <DotChart
              data={series}
              compare={prevSeries}
              compareLabel={`Previous ${days} days`}
              x="date"
              kind="money"
              currency={prog.currency}
              height={320}
              label={`Daily partner performance over the last ${days} days`}
              series={[
                { key: "revenue", name: "Revenue", total: mw(cur.revenue), delta: dRev },
                { key: "commissions", name: "Commissions", total: mw(cur.commissions), delta: dCom },
                {
                  key: "clicks",
                  name: "Clicks",
                  kind: "number",
                  total: formatNumber(cur.clicks),
                  delta: delta(cur.clicks, prev.clicks),
                },
                {
                  key: "customers",
                  name: "Customers",
                  kind: "number",
                  total: formatNumber(cur.customers),
                  delta: dCust,
                },
              ]}
            />
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <PayoutCard
            base={base}
            balance={mw(balance)}
            waiting={waiting}
            m={m}
            lines={[
              ["Ready to pay", m(cur.owed)],
              ["In refund window", m(cur.pending)],
              ["Held for review", m(cur.held)],
            ]}
          />
          <section className="flex-1 rounded-lg border border-border bg-surface">
            <h2 className="px-4 pt-3.5 pb-1.5 text-[13px] font-medium text-fg">Needs you</h2>
            {needs.length ? (
              <ul className="px-1.5 pb-1.5">
                {needs.slice(0, 5).map((n) => (
                  <li key={n.title}>
                    <Link
                      href={n.href}
                      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] hover:bg-surface-2"
                    >
                      <n.icon size={15} className="shrink-0 text-subtle" />
                      <span className="min-w-0 flex-1 truncate text-fg">{n.title}</span>
                      <span className="num shrink-0 text-xs text-subtle">{n.meta}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-[13px] text-subtle">Nothing is waiting on you.</p>
            )}
          </section>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2 sm:px-5">
            <h2 className="text-[15px] font-medium tracking-[-0.01em] text-fg">Top partners</h2>
            <Link
              href={`${base}/partners`}
              className="flex items-center gap-1 text-[13px] text-muted hover:text-fg"
            >
              All partners <ArrowRight size={13} />
            </Link>
          </div>
          {active.length ? (
            <div className="overflow-x-auto px-2 pb-2">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="text-xs text-subtle">
                    <th className="rounded-l-md bg-surface-2 px-3 py-2 text-left font-normal">Partner</th>
                    <th className="bg-surface-2 px-3 py-2 text-left font-normal">Status</th>
                    <th className="bg-surface-2 px-3 py-2 text-right font-normal">Customers</th>
                    <th className="bg-surface-2 px-3 py-2 text-right font-normal">Share</th>
                    <th className="rounded-r-md bg-surface-2 px-3 py-2 text-right font-normal">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {active.map((t) => {
                    const share = cur.revenue ? t.revenue / cur.revenue : 0;
                    return (
                      <tr key={t.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2.5">
                          <Link
                            href={`${base}/partners/${t.id}`}
                            className="flex items-center gap-2.5 text-fg"
                          >
                            <Avatar name={t.name} src={t.avatarUrl} size={26} />
                            <span className="min-w-0">
                              <span className="block truncate hover:underline">{t.name}</span>
                              <span className="block truncate text-xs text-subtle">
                                {formatNumber(t.clicks)} clicks
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={t.status === "approved" ? "active" : t.status} />
                        </td>
                        <td className="num px-3 py-2.5 text-right text-muted">{t.customers}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            <span className="h-1 w-12 overflow-hidden rounded-[1px] bg-surface-3" aria-hidden>
                              <span className="block h-full bg-accent" style={{ width: `${share * 100}%` }} />
                            </span>
                            <span className="num w-11 text-right text-muted">{formatPercent(share, 1)}</span>
                          </div>
                        </td>
                        <td className="num px-3 py-2.5 text-right font-medium text-fg">{m(t.revenue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              className="py-12"
              icon={Users}
              mascot="hello"
              title="No partner activity yet"
              description="Revenue shows up here as soon as a referred customer pays."
              action={
                <Button asChild variant="primary">
                  <Link href={`${base}/recruiter`}>Invite partners</Link>
                </Button>
              }
            />
          )}
        </section>
        <AgentCard base={base} program={prog.name} />
      </div>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-medium tracking-[-0.01em] text-fg">Commission board</h2>
            <p className="text-xs text-subtle">Where each commission sits right now, sorted newest first</p>
          </div>
          <Link
            href={`${base}/commissions?view=board`}
            className="flex items-center gap-1 text-[13px] text-muted hover:text-fg"
          >
            Open board <ArrowRight size={13} />
          </Link>
        </div>
        <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
          {COLUMNS.map((col, i) => {
            const t = totals.find((x) => x.status === col.status);
            const cards = board[i] ?? [];
            return (
              <div
                key={col.status}
                className="flex w-[264px] shrink-0 snap-start flex-col rounded-lg bg-surface-2 p-1.5 sm:w-auto sm:min-w-0"
              >
                <div className="flex items-center gap-2 px-2 pt-1 pb-2">
                  <col.icon className="size-4 shrink-0 text-subtle" aria-hidden />
                  <span className="truncate text-[13px] font-medium text-fg">{col.label}</span>
                  <span className="num rounded-[4px] bg-surface px-1.5 text-[11px] leading-[18px] font-medium text-muted ring-1 ring-border">
                    {formatNumber(t?.n ?? 0)}
                  </span>
                  <span className="num ml-auto text-xs text-subtle">{mw(Number(t?.total ?? 0))}</span>
                </div>
                <ul className="flex flex-1 flex-col gap-1.5">
                  {cards.map(({ c, name, avatar, customer }) => (
                    <li key={c.id}>
                      <Link
                        href={`${base}/commissions?q=${encodeURIComponent(name)}`}
                        className="flex items-center gap-3 rounded-md bg-surface p-3 hover:bg-surface/70 dark:bg-surface-3"
                      >
                        <Avatar name={name} src={avatar} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-fg">{name}</span>
                          <span className="block truncate text-[11px] text-subtle">
                            {col.status === "held"
                              ? (c.heldReason ?? "Waiting for review").replace(/_/g, " ")
                              : col.status === "pending" && c.holdUntil
                                ? `Clears ${c.holdUntil.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                                : c.kind === "override"
                                  ? KIND.override
                                  : (customer ?? KIND[c.kind] ?? c.kind)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "num text-[13px] font-medium",
                            c.amount < 0 ? "text-danger" : "text-fg",
                          )}
                        >
                          {c.amount < 0 ? `−${m(-c.amount, c.currency)}` : m(c.amount, c.currency)}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {cards.length === 0 ? (
                    <li className="rounded-md border border-dashed border-border-strong px-3 py-5 text-center text-xs text-subtle">
                      Nothing here
                    </li>
                  ) : null}
                </ul>
                {(t?.n ?? 0) > cards.length ? (
                  <Link
                    href={`${base}/commissions?status=${col.status}`}
                    className="mt-1.5 rounded-md py-1.5 text-center text-xs text-muted hover:bg-surface hover:text-fg"
                  >
                    {formatNumber((t?.n ?? 0) - cards.length)} more
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function Metric({
  icon: Icon,
  label,
  d,
  value,
  caption,
  children,
}: {
  icon: typeof Banknote;
  label: string;
  d: number;
  value: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="@container flex min-w-0 flex-col border-border p-4 sm:p-5 [&:nth-child(-n+2)]:border-b xl:[&:nth-child(-n+2)]:border-b-0 [&:nth-child(odd)]:border-r xl:[&:not(:last-child)]:border-r">
      {/* wide card: label and trend badge share a line; narrow card (phone): the badge sits under the label */}
      <div className="flex items-center justify-between gap-2 @max-[230px]:flex-col @max-[230px]:items-start @max-[230px]:gap-1.5">
        <span className="flex min-w-0 max-w-full items-center gap-2 text-[13px] text-muted">
          <Icon size={16} className="shrink-0 text-subtle @max-[250px]:hidden" aria-hidden />{" "}
          <span className="truncate">{label}</span>
        </span>
        <Badge tone={d >= 0 ? "success" : "danger"} className="num shrink-0 gap-1">
          {d >= 0 ? <TrendUp size={13} aria-hidden /> : <TrendDown size={13} aria-hidden />}
          {Math.abs(d * 100).toFixed(1)}%
        </Badge>
      </div>
      <div className="figure mt-2 truncate text-[clamp(20px,13cqi,28px)] leading-8 text-fg">{value}</div>
      <p className="truncate text-xs text-subtle">{caption}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** The one dark surface on the page: the money waiting to go out, like a statement slip. */
function PayoutCard({
  base,
  balance,
  waiting,
  m,
  lines,
}: {
  base: string;
  balance: string;
  waiting: { n: number; total: number };
  m: (n: number) => string;
  lines: [string, string][];
}) {
  return (
    <section className="rounded-lg bg-[#16171a] p-4 text-white ring-1 ring-white/10 dark:bg-[#1d1e22]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] text-white/70">
          <Banknote size={15} /> Partner balance
        </span>
        <span className="stamp text-white/50!">
          {new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" })}
        </span>
      </div>
      <div className="figure mt-3 text-[30px] leading-9">{balance}</div>
      <p className="text-xs text-white/60">owed across every partner right now</p>
      <dl className="mt-4 flex flex-col gap-2 text-[13px]">
        {lines.map(([k, v]) => (
          <div key={k} className="flex items-center">
            <dt className="text-white/60">{k}</dt>
            <span className="leader opacity-40" aria-hidden />
            <dd className="num text-white">{v}</dd>
          </div>
        ))}
      </dl>
      <Link
        href={`${base}/payouts`}
        className="mt-4 flex h-9 items-center justify-center gap-2 rounded-md bg-white text-[13px] font-medium text-[#16171a] hover:bg-white/90"
      >
        {waiting.n
          ? `Review ${waiting.n} payout${waiting.n === 1 ? "" : "s"} · ${m(waiting.total)}`
          : "Open payouts"}
        <ArrowRight size={14} />
      </Link>
    </section>
  );
}

const PROMPTS = [
  { q: "How much do we owe partners right now?", icon: Banknote },
  { q: "Who are my top partners this quarter?", icon: Trophy },
  { q: "Any suspicious activity this week?", icon: ShieldAlert },
  { q: "Which partners have gone quiet?", icon: Users },
];

/** Ask in plain words. Answers come from the program's own data. */
function AgentCard({ base, program }: { base: string; program: string }) {
  return (
    <section className="flex flex-col self-start rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between px-4 pt-3.5">
        <h2 className="flex items-center gap-2 text-[13px] font-medium text-fg">
          <Sparkles size={14} weight="fill" className="text-subtle" /> Ask about {program}
        </h2>
        <Link
          href={`${base}/assistant`}
          aria-label="Open the assistant"
          className="flex size-6 items-center justify-center rounded-[5px] text-subtle hover:bg-surface-2 hover:text-fg"
        >
          <Expand size={14} />
        </Link>
      </div>
      <ul className="mt-2 px-1.5">
        {PROMPTS.map((p) => (
          <li key={p.q}>
            <Link
              href={`${base}/assistant?q=${encodeURIComponent(p.q)}`}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-fg hover:bg-surface-2"
            >
              <p.icon size={15} className="shrink-0 text-subtle" />
              <span className="min-w-0 flex-1 truncate">{p.q}</span>
            </Link>
          </li>
        ))}
      </ul>
      <form action={`${base}/assistant`} className="p-3">
        <label className="flex items-center gap-2 rounded-md border border-border bg-surface-2 p-1.5 focus-within:border-border-strong">
          <span className="sr-only">Ask the agent</span>
          <input
            name="q"
            placeholder="Ask anything…"
            autoComplete="off"
            className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-[13px] text-fg placeholder:text-subtle focus-visible:outline-none"
          />
          <button
            type="submit"
            aria-label="Ask"
            className="flex size-7 shrink-0 items-center justify-center rounded-[5px] bg-primary text-primary-fg hover:bg-primary-hover"
          >
            <Send size={14} weight="fill" />
          </button>
        </label>
      </form>
    </section>
  );
}
