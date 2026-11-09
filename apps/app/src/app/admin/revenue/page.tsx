import { auditLog, workspace } from "@openpromoter/db";
import { Badge, Card, CardHeader } from "@openpromoter/ui";
import { AlertTriangle, Coins, ExternalLink, TrendUp, Users } from "@openpromoter/ui/icons";
import { desc, eq, like } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { BarChart } from "@/components/charts";
import { LedgerLine, PageHeader, Section, Stat } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { PLANS, planById } from "@/lib/plans";
import { adminWorkspacesCached, day, requireAdmin } from "@/server/admin";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Revenue · Admin" };
export const dynamic = "force-dynamic";

const REGION: Record<string, string> = {
  abroad: "Outside India",
  in_home: "Uttar Pradesh",
  in_other: "Other Indian states",
};

/** What OpenPromoter earns: MRR by plan, money at risk, who is about to upgrade and every plan change. */
export default async function AdminRevenue() {
  await requireAdmin();
  const [{ rows }, changes] = await Promise.all([
    adminWorkspacesCached(),
    db()
      .select({
        at: auditLog.createdAt,
        data: auditLog.data,
        workspaceId: auditLog.workspaceId,
        name: workspace.name,
      })
      .from(auditLog)
      .leftJoin(workspace, eq(workspace.id, auditLog.workspaceId))
      .where(like(auditLog.action, "plan.%"))
      .orderBy(desc(auditLog.createdAt))
      .limit(25),
  ]);
  const paying = rows.filter((w) => w.paying);
  const mrr = paying.reduce((a, w) => a + w.mrr, 0);
  const atRisk = paying.filter((w) => w.status === "past_due");
  const ending = paying.filter((w) => w.cancelAt);
  const upgrade = rows.filter((w) => w.usageShare >= 0.8);
  const byPlan = PLANS.filter((p) => p.price > 0).map((p) => {
    const on = paying.filter((w) => w.plan.id === p.id);
    return { plan: p.name, count: on.length, mrr: on.length * p.price };
  });
  const regions = Object.entries(
    paying.reduce<Record<string, number>>((a, w) => {
      const k = REGION[w.region ?? ""] ?? "Not set";
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {}),
  );
  return (
    <>
      <PageHeader
        title="Revenue"
        description="OpenPromoter Cloud's own revenue from plans. Prices before GST, in USD."
        actions={
          <a
            href="https://dashboard.stripe.com/subscriptions"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
          >
            Stripe subscriptions <ExternalLink className="size-3.5" />
          </a>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={Coins}
          label="Monthly recurring revenue"
          value={formatMoney(mrr, "usd")}
          sub={`${formatMoney(mrr * 12, "usd")} a year`}
        />
        <Stat
          icon={Users}
          label="Paying workspaces"
          value={paying.length}
          sub={`${formatMoney(paying.length ? Math.round(mrr / paying.length) : 0, "usd")} average a month`}
        />
        <Stat
          icon={AlertTriangle}
          label="At risk"
          value={formatMoney(
            atRisk.reduce((a, w) => a + w.mrr, 0) + ending.reduce((a, w) => a + w.mrr, 0),
            "usd",
          )}
          sub={`${atRisk.length} failing ${atRisk.length === 1 ? "payment" : "payments"} · ${ending.length} ending`}
        />
        <Stat
          icon={TrendUp}
          label="Ready to upgrade"
          value={upgrade.length}
          sub="At 80% or more of their plan's revenue limit"
        />
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <h2 className="text-[14px] font-medium text-fg">MRR by plan</h2>
          <p className="mt-0.5 mb-5 text-[13px] text-muted">Monthly price times paying workspaces</p>
          <BarChart
            data={byPlan.map((b) => ({ plan: b.plan, mrr: b.mrr / 100 }))}
            x="plan"
            y="mrr"
            name="MRR"
            label="MRR by plan"
          />
        </Card>
        <Card>
          <CardHeader title="Plans" />
          <div className="flex flex-col gap-2.5 px-5 pb-5 text-[13px]">
            {byPlan.map((b) => (
              <LedgerLine
                key={b.plan}
                label={`${b.plan} · ${b.count} ${b.count === 1 ? "workspace" : "workspaces"}`}
                value={formatMoney(b.mrr, "usd")}
              />
            ))}
            <LedgerLine
              label={`Free · ${rows.length - paying.length} workspaces`}
              value={formatMoney(0, "usd")}
            />
            <LedgerLine label="Total" value={formatMoney(mrr, "usd")} strong />
            <div className="mt-2 border-t border-border pt-3 text-xs text-subtle">
              Billed from:{" "}
              {regions.length ? regions.map(([k, n]) => `${k} ${n}`).join(" · ") : "no paying workspaces yet"}
            </div>
          </div>
        </Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="At risk" description="Failing payments while Stripe retries, and plans set to end.">
          <Card>
            <WorkspaceList
              rows={[...atRisk, ...ending.filter((w) => w.status !== "past_due")].map((w) => ({
                id: w.id,
                name: w.name,
                owner: w.owner,
                badge:
                  w.status === "past_due"
                    ? { tone: "danger" as const, text: "Payment failing" }
                    : { tone: "warning" as const, text: `Ends ${day(w.cancelAt!)}` },
                value: formatMoney(w.mrr, "usd"),
              }))}
              empty="No failing payments and no plans ending."
            />
          </Card>
        </Section>
        <Section title="Ready to upgrade" description="Close to or over their plan's monthly revenue limit.">
          <Card>
            <WorkspaceList
              rows={upgrade
                .sort((a, b) => b.usageShare - a.usageShare)
                .slice(0, 10)
                .map((w) => ({
                  id: w.id,
                  name: w.name,
                  owner: w.owner,
                  badge: {
                    tone: w.usageShare > 1 ? ("warning" as const) : ("info" as const),
                    text: `${Math.round(w.usageShare * 100)}% of ${w.plan.name}`,
                  },
                  value: formatMoney(w.usage, "usd"),
                }))}
              empty="Nobody is near their plan's limit."
            />
          </Card>
        </Section>
      </div>
      <Section
        title="Plan changes"
        description="Upgrades, downgrades, failed payments and endings, newest first."
      >
        <Card>
          {changes.length ? (
            <ul className="divide-y divide-border text-[13px]">
              {changes.map((c, i) => {
                const d = (c.data ?? {}) as { from?: string; to?: string; status?: string };
                const from = planById(d.from ?? "free").name;
                const to = planById(d.to ?? "free").name;
                return (
                  <li key={`${c.workspaceId}-${i}`}>
                    <Link
                      href={`/admin/w/${c.workspaceId}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2"
                    >
                      <span className="w-28 shrink-0 text-muted">{day(c.at)}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-fg">
                        {c.name ?? c.workspaceId}
                      </span>
                      <span className="text-muted">{from === to ? to : `${from} to ${to}`}</span>
                      {d.status && d.status !== "active" ? (
                        <Badge tone={d.status === "past_due" ? "danger" : "neutral"}>
                          {d.status.replace("_", " ")}
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[13px] text-muted">
              Plan changes appear here from the first new subscription.
            </p>
          )}
        </Card>
      </Section>
    </>
  );
}

function WorkspaceList({
  rows,
  empty,
}: {
  rows: {
    id: string;
    name: string;
    owner: string | null;
    badge: { tone: "danger" | "warning" | "info"; text: string };
    value: string;
  }[];
  empty: string;
}) {
  if (!rows.length) return <p className="px-5 py-6 text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/admin/w/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-fg">{r.name}</span>
              <span className="block truncate text-xs text-subtle">{r.owner}</span>
            </span>
            <Badge tone={r.badge.tone}>{r.badge.text}</Badge>
            <span className="num w-24 text-right text-[13px]">{r.value}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
