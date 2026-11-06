import { campaign, click, commission, link, referral } from "@openpromoter/db";
import { Button, Card, CardBody, CardHeader } from "@openpromoter/ui";
import { ArrowRight, Check, Coins, Megaphone, Target, Users } from "@openpromoter/ui/icons";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { DotChart } from "@/components/charts";
import { PageHeader, Stat } from "@/components/page";
import { describeRule } from "@/lib/campaign-labels";
import { formatMoney, formatNumber } from "@/lib/money";
import { durationLabel, rateLabel } from "@/lib/program-labels";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { balances } from "@/server/ledger";
import { timeseriesForPartner } from "@/server/partner-stats";
import { scheduleLabel } from "../../offer";
import { PayoutSlip } from "../slip";
import { LinkTicket } from "../ticket";

export default async function PortalHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program: p, partner: pt } = await partnerCtx(slug);
  const m = (n: number) => formatMoney(n, p.currency);
  const mw = (n: number) => formatMoney(n, p.currency, { whole: true });
  const [[clicks], [refs], bal, series, live, [firstLink]] = await Promise.all([
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(click)
      .where(and(eq(click.partnerId, pt.id), eq(click.isBot, false))),
    db()
      .select({
        leads: sql<number>`count(*)::int`,
        customers: sql<number>`count(*) filter (where ${referral.convertedAt} is not null)::int`,
      })
      .from(referral)
      .where(eq(referral.partnerId, pt.id)),
    balances(p.id, [pt.id]),
    timeseriesForPartner(pt.id, 30),
    db()
      .select()
      .from(campaign)
      .where(and(eq(campaign.programId, p.id), eq(campaign.status, "active"))),
    // the first link is the partner's main one; deep links made later never replace it
    db()
      .select()
      .from(link)
      .where(eq(link.partnerId, pt.id))
      .orderBy(asc(link.createdAt), asc(link.id))
      .limit(1),
  ]);
  const b = bal.find((x) => x.currency === p.currency) ?? { approved: 0, pending: 0, held: 0, paid: 0 };
  const host = p.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const short = firstLink
    ? `${env.APP_URL}/r/${slug}/l/${firstLink.key}`
    : `${env.APP_URL}/r/${slug}/${pt.code}`;
  const steps = [
    {
      done: !!pt.payoutMethod && (pt.payoutMethod !== "stripe" || pt.stripePayoutsEnabled),
      label: "Add a payout method",
      href: "/payouts",
    },
    { done: (clicks?.n ?? 0) > 0, label: "Share your link", href: "/links" },
    { done: (refs?.leads ?? 0) > 0, label: "Get your first referral", href: "/content" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const [month] = await db()
    .select({ n: sql<number>`coalesce(sum(${commission.amount}),0)::int` })
    .from(commission)
    .where(
      and(
        eq(commission.partnerId, pt.id),
        gte(commission.createdAt, new Date(Date.now() - 30 * 86_400_000)),
        sql`${commission.status} <> 'reversed'`,
      ),
    );
  const nClicks = clicks?.n ?? 0;
  const conv = nClicks ? (refs?.customers ?? 0) / nClicks : 0;
  return (
    <>
      <AutoRefresh />
      <PageHeader
        title={`Hi ${pt.name.split(" ")[0]}`}
        description={
          <>
            You earn <b className="font-medium text-fg">{rateLabel(p)}</b> {durationLabel(p)}. Payouts go out{" "}
            {scheduleLabel(p).toLowerCase()} once you're owed {m(p.minPayout)}.
          </>
        }
      />

      {pt.status !== "approved" ? (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] text-fg">
          {pt.status === "pending"
            ? "Your application is waiting for approval. Your link starts tracking once you're approved."
            : "Your partner account isn't active, so your link doesn't track."}
        </p>
      ) : null}
      <LinkTicket
        url={short}
        code={pt.code}
        note={
          <>
            Or add{" "}
            <code className="text-muted">
              ?{p.referralParam}={pt.code}
            </code>{" "}
            to any page on {host}
          </>
        }
      />

      {doneCount < 3 ? (
        <Card className="mt-4 flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3 lg:pr-3">
            <div className="flex gap-1" aria-hidden>
              {steps.map((s) => (
                <span
                  key={s.label}
                  className={`h-1.5 w-5 rounded-full ${s.done ? "bg-primary" : "bg-surface-3"}`}
                />
              ))}
            </div>
            <div>
              <div className="text-[13px] font-medium text-fg">Get set up</div>
              <div className="text-xs whitespace-nowrap text-subtle">{doneCount} of 3 done</div>
            </div>
          </div>
          <ul className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-2" aria-label="Setup progress">
            {steps.map((s) => (
              <li key={s.label}>
                <Link
                  href={`/p/${slug}/portal${s.href}`}
                  className={`flex h-9 items-center gap-2 rounded-md text-[13px] whitespace-nowrap transition-colors ${
                    s.done
                      ? "text-subtle hover:text-muted"
                      : "border border-border bg-surface px-3 text-fg hover:border-border-strong"
                  }`}
                >
                  {s.done ? (
                    <span className="flex size-4 items-center justify-center rounded-full bg-success-soft text-success">
                      <Check className="size-3" strokeWidth={2} />
                    </span>
                  ) : (
                    <span className="size-4 rounded-full border border-dashed border-border-strong" />
                  )}
                  <span className={s.done ? "line-through decoration-border-strong" : ""}>{s.label}</span>
                  {!s.done ? <ArrowRight className="ml-auto size-3.5 text-subtle" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            <Stat
              className="col-span-2 sm:col-span-1"
              label="Earned"
              icon={Coins}
              iconClass="text-accent"
              value={mw(month?.n ?? 0)}
              sub={
                <>
                  in the <b>last 30 days</b>
                </>
              }
            />
            <Stat
              label="Referrals"
              icon={Users}
              value={formatNumber(refs?.leads ?? 0)}
              sub={
                <>
                  <b>{formatNumber(refs?.customers ?? 0)}</b> became paying customers
                </>
              }
            />
            <Stat
              label="Clicks"
              icon={Target}
              value={formatNumber(nClicks)}
              sub={
                <>
                  <b>{(conv * 100).toFixed(1)}%</b> turned into customers
                </>
              }
            />
          </div>
          <Card>
            <CardHeader
              title="Earnings"
              description={`Last 30 days · ${m(b.pending)} still inside the refund window`}
            />
            <CardBody>
              <DotChart
                data={series}
                x="date"
                kind="money"
                currency={p.currency}
                series={[{ key: "earned", name: "Earned" }]}
                label="Earnings over the last 30 days"
                height={200}
              />
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <PayoutSlip
            m={m}
            b={b}
            min={p.minPayout}
            schedule={scheduleLabel(p)}
            method={pt.payoutMethod}
            href={`/p/${slug}/portal/payouts`}
          />
          {live.length ? (
            <Card>
              <CardHeader title="Running now" description="Campaigns that pay extra this month." />
              <ul className="divide-y divide-border border-t border-border">
                {live.map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 px-5 py-3">
                    <div className="flex items-start gap-2.5 text-[13px]">
                      <Megaphone className="mt-0.5 size-4 shrink-0 text-accent" />
                      <span className="min-w-0">
                        <span className="block font-medium text-fg">{c.name}</span>
                        {describeRule(c.rule, p.currency) !== c.name ? (
                          <span className="block text-muted">{describeRule(c.rule, p.currency)}</span>
                        ) : null}
                      </span>
                    </div>
                    {c.rule.kind === "bounty" && c.rule.trigger === "post" ? (
                      <Button asChild size="sm" className="self-start">
                        <Link href={`/p/${slug}/portal/content?bounty=${c.id}`}>Submit a post</Link>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
