import { Badge, Card } from "@openpromoter/ui";
import { Activity, Coins, ExternalLink, TrendUp, UsersRound } from "@openpromoter/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { BarChart, DotChart } from "@/components/charts";
import { PageHeader, Section, Stat } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { adminPulse, adminWorkspacesCached, attention, requireAdmin } from "@/server/admin";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "0%");

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin(); // the layout checks too, but a page renders alongside it
  const sp = await searchParams;
  const { at, rows } = await adminWorkspacesCached(sp.fresh === "1");
  const pulse = await adminPulse(rows);
  const flagged = rows.map((w) => ({ w, why: attention(w) })).filter((x) => x.why.length);
  const h = pulse.health;
  return (
    <>
      <PageHeader
        title="Overview"
        description="Every workspace on OpenPromoter Cloud. Read-only: nothing here changes a customer's data."
        actions={
          <>
            <span className="text-[13px] text-subtle">
              Figures from {at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} ·{" "}
              <a href="/admin?fresh=1" className="text-muted hover:text-fg">
                Refresh
              </a>
            </span>
            <a
              href="https://dashboard.stripe.com/subscriptions"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
            >
              Stripe subscriptions <ExternalLink className="size-3.5" />
            </a>
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={Coins}
          label="Monthly recurring revenue"
          value={formatMoney(pulse.mrr, "usd")}
          sub={
            <>
              <b>{pulse.paying}</b> paying {pulse.paying === 1 ? "workspace" : "workspaces"}
              {pulse.atRisk ? (
                <>
                  {" "}
                  · <b>{formatMoney(pulse.atRisk, "usd")}</b> with a failing payment
                </>
              ) : null}
            </>
          }
          hint="Plan prices before GST. Includes plans with a failing payment while Stripe retries."
        />
        <Stat
          icon={UsersRound}
          label="Workspaces"
          value={pulse.workspaces}
          sub={
            <>
              <b>{pulse.new7}</b> new this week · <b>{pulse.users}</b>{" "}
              {pulse.users === 1 ? "person" : "people"} signed up
            </>
          }
        />
        <Stat
          icon={Activity}
          label="Active this week"
          value={pulse.active7}
          sub={
            <>
              <b>{pct(pulse.active7, pulse.workspaces)}</b> of workspaces signed in during the last 7 days
            </>
          }
        />
        <Stat
          icon={TrendUp}
          label="Partner revenue this month"
          value={formatMoney(pulse.revenue, "usd")}
          sub="Sales partners referred in every program"
          hint="Sum of sale amounts tracked this month, in each program's own currency treated as USD."
        />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <h2 className="text-[14px] font-medium text-fg">Signups</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            <b className="font-medium text-fg">{pulse.new30}</b> new{" "}
            {pulse.new30 === 1 ? "workspace" : "workspaces"} in the last 30 days
          </p>
          <div className="mt-4">
            <DotChart
              data={pulse.signups}
              x="day"
              series={[{ key: "signups", name: "Signups" }]}
              height={180}
              label="New workspaces per day"
            />
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="text-[14px] font-medium text-fg">Activation</h2>
          <p className="mt-0.5 mb-5 text-[13px] text-muted">
            How far each of the <b className="font-medium text-fg">{pulse.workspaces}</b>{" "}
            {pulse.workspaces === 1 ? "workspace" : "workspaces"} got
          </p>
          <BarChart data={pulse.funnel} x="step" y="count" name="Workspaces" label="Activation steps" />
        </Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section
          title="Needs you"
          description="Workspaces with a payment problem, a limit reached or a stalled setup."
          action={
            <Link href="/admin/workspaces?status=attention" className="text-[13px] text-muted hover:text-fg">
              See all {flagged.length}
            </Link>
          }
        >
          <Card>
            {flagged.length ? (
              <ul className="divide-y divide-border">
                {flagged.slice(0, 8).map(({ w, why }) => (
                  <li key={w.id}>
                    <Link
                      href={`/admin/w/${w.id}`}
                      className="flex flex-col gap-2 px-5 py-3.5 hover:bg-surface-2 sm:flex-row sm:items-center"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-fg">{w.name}</span>
                        <span className="block truncate text-xs text-subtle">{w.owner}</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {why.map((x) => (
                          <Badge key={x.text} tone={x.tone}>
                            {x.text}
                          </Badge>
                        ))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[13px] text-muted">Nothing needs you right now.</p>
            )}
          </Card>
        </Section>
        <Section
          title="System"
          description="Background work in the last 24 hours."
          action={
            <Link href="/admin/jobs?status=failed" className="text-[13px] text-muted hover:text-fg">
              Open jobs
            </Link>
          }
        >
          <Card className="p-5">
            <div className="flex flex-col gap-2.5 text-[13px]">
              <Row label="Jobs waiting over 5 minutes" value={h.waiting} bad={h.waiting > 0} />
              <Row label="Jobs failed" value={h.failedJobs.length} bad={h.failedJobs.length > 0} />
              <Row label="Partner webhooks failed" value={h.failedHooks} bad={h.failedHooks > 0} />
            </div>
            {h.failedJobs.length ? (
              <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
                {h.failedJobs.map((j) => (
                  <li key={`${j.name}-${j.at?.toISOString()}`} className="text-xs leading-5">
                    <span className="font-mono text-fg">{j.name}</span>
                    <span className="block truncate text-subtle">{j.error ?? "No message"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 border-t border-border pt-4 text-xs text-subtle">
                All background work is running.
              </p>
            )}
          </Card>
        </Section>
      </div>
    </>
  );
}

function Row({ label, value, bad }: { label: string; value: number; bad: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={`num font-medium ${bad ? "text-danger" : "text-fg"}`}>{value}</span>
    </div>
  );
}
