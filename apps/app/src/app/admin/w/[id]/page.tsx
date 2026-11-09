import { Badge, Card, CardHeader, Progress } from "@openpromoter/ui";
import { ArrowLeft, Check, Circle, ExternalLink } from "@openpromoter/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { LedgerLine, PageHeader, Section } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { adminWorkspace, attention, BILLING_TONE, billingLabel, requireAdmin, STEPS } from "@/server/admin";
import { programUrl } from "@/server/ref-link";

export const metadata: Metadata = { title: "Workspace · Admin" };
export const dynamic = "force-dynamic";

const date = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "–";
const when = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const REGION = { abroad: "Outside India", in_home: "India: Uttar Pradesh", in_other: "India: another state" };
const PARTNER_TONE = { approved: "success", pending: "warning" } as const;
const stripe = (path: string) => `https://dashboard.stripe.com/${path}`;

export default async function AdminWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(); // the layout checks too, but a page renders alongside it
  const { id } = await params;
  const { w, members, programs, partners, events } = await adminWorkspace(id);
  const why = attention(w);
  return (
    <>
      <Link
        href="/admin"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> All workspaces
      </Link>
      <PageHeader
        title={w.name}
        description={
          <>
            {w.owner ?? "No owner"} · joined {date(w.createdAt)} ·{" "}
            <span className="font-mono text-xs">{w.id}</span>
          </>
        }
        actions={why.map((x) => (
          <Badge key={x.text} tone={x.tone}>
            {x.text}
          </Badge>
        ))}
      />
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader title="Plan and billing" />
          <div className="flex flex-col gap-2.5 px-5 pb-5">
            <LedgerLine label="Plan" value={w.plan.name} strong />
            <LedgerLine
              label="Status"
              value={
                w.status ? (
                  <Badge tone={BILLING_TONE[w.status] ?? "neutral"}>{billingLabel(w.status)}</Badge>
                ) : (
                  "No subscription"
                )
              }
            />
            <LedgerLine label="Monthly price" value={formatMoney(w.mrr, "usd")} />
            <LedgerLine label="Billing location" value={w.region ? REGION[w.region] : "Not set"} />
            {w.cancelAt ? <LedgerLine label="Plan ends" value={date(w.cancelAt)} /> : null}
            {w.customerId ? (
              <LedgerLine
                label="Stripe customer"
                value={
                  <a
                    href={stripe(`customers/${w.customerId}`)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent-text hover:underline"
                  >
                    Open <ExternalLink className="size-3" />
                  </a>
                }
              />
            ) : null}
            {w.subscriptionId ? (
              <LedgerLine
                label="Subscription"
                value={
                  <a
                    href={stripe(`subscriptions/${w.subscriptionId}`)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent-text hover:underline"
                  >
                    Open <ExternalLink className="size-3" />
                  </a>
                }
              />
            ) : null}
          </div>
        </Card>
        <Card>
          <CardHeader title="Use this month" />
          <div className="flex flex-col gap-4 px-5 pb-5 text-[13px]">
            <div>
              <div className="mb-2 flex justify-between">
                <span className="text-muted">Partner revenue</span>
                <span className="num text-fg">
                  {formatMoney(w.usage, "usd")} of {formatMoney(w.plan.revenueLimit, "usd")}
                </span>
              </div>
              <Progress value={Math.min(100, w.usageShare * 100)} label="Partner revenue" />
            </div>
            <div>
              <div className="mb-2 flex justify-between">
                <span className="text-muted">AI</span>
                <span className="num text-fg">
                  {formatMoney(Math.round(w.aiSpent / 10_000), "usd")} of{" "}
                  {formatMoney(w.plan.aiBudgetMicros / 10_000, "usd")}
                </span>
              </div>
              <Progress value={Math.min(100, w.aiShare * 100)} label="AI" />
            </div>
            <LedgerLine
              label="Clicks in the last 30 days"
              value={<span className="num">{w.clicks30}</span>}
            />
            <LedgerLine label="Sales tracked all time" value={<span className="num">{w.sales}</span>} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Setup" description={`${w.done} of ${STEPS.length} steps done`} />
          <ul className="flex flex-col gap-2.5 px-5 pb-5 text-[13px]">
            {STEPS.map((s) => (
              <li key={s.key} className="flex items-center gap-2.5">
                {w.steps[s.key] ? (
                  <Check className="size-4 text-success" aria-label="Done" />
                ) : (
                  <Circle className="size-4 text-subtle" aria-label="Not yet" />
                )}
                <span className={w.steps[s.key] ? "text-fg" : "text-muted"}>{s.label}</span>
                {s.key === "billing" && w.providers.length ? (
                  <span className="ml-auto text-xs text-subtle capitalize">{w.providers.join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Section title="Programs">
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead className="text-left text-xs text-subtle">
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 font-normal">Program</th>
                <th className="px-5 py-2.5 font-normal">Website</th>
                <th className="px-5 py-2.5 font-normal">Custom domain</th>
                <th className="px-5 py-2.5 text-right font-normal">Partners</th>
                <th className="px-5 py-2.5 font-normal">Tracking</th>
                <th className="px-5 py-2.5 font-normal">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {programs.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3">
                    <a
                      href={programUrl(p)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-fg hover:underline"
                    >
                      {p.name}
                    </a>
                  </td>
                  <td className="max-w-56 truncate px-5 py-3 text-muted">
                    {p.websiteUrl.replace(/^https?:\/\//, "")}
                  </td>
                  <td className="px-5 py-3">
                    {p.customDomain ? (
                      <span className="flex items-center gap-2">
                        <span className="text-fg">{p.customDomain}</span>
                        <Badge tone={p.customDomainVerifiedAt ? "success" : "warning"}>
                          {p.customDomainVerifiedAt ? "Verified" : "Waiting"}
                        </Badge>
                      </span>
                    ) : (
                      <span className="text-subtle">–</span>
                    )}
                  </td>
                  <td className="num px-5 py-3 text-right">{p.partners}</td>
                  <td className="px-5 py-3 text-muted">
                    {p.installVerifiedAt ? date(p.installVerifiedAt) : "Not yet"}
                  </td>
                  <td className="px-5 py-3 text-muted">{date(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {programs.length ? null : <p className="px-5 py-6 text-[13px] text-muted">No programs yet.</p>}
        </Card>
      </Section>
      <Section
        title="Partners"
        description={
          partners.length >= 200
            ? "The 200 who brought in the most. Newest next."
            : "Everyone who joined this founder's programs, highest revenue first."
        }
      >
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="text-left text-xs text-subtle">
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 font-normal">Partner</th>
                {programs.length > 1 ? <th className="px-5 py-2.5 font-normal">Program</th> : null}
                <th className="px-5 py-2.5 font-normal">Status</th>
                <th className="px-5 py-2.5 font-normal">Joined</th>
                <th className="px-5 py-2.5 text-right font-normal">Revenue</th>
                <th className="px-5 py-2.5 text-right font-normal">Earned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {partners.map((pt) => (
                <tr key={pt.id}>
                  <td className="px-5 py-3">
                    <div className="font-medium text-fg">{pt.name}</div>
                    <div className="text-xs text-muted">
                      {pt.email}
                      {pt.country ? ` · ${pt.country}` : ""}
                    </div>
                  </td>
                  {programs.length > 1 ? <td className="px-5 py-3 text-muted">{pt.program.name}</td> : null}
                  <td className="px-5 py-3">
                    <Badge tone={PARTNER_TONE[pt.status as keyof typeof PARTNER_TONE] ?? "neutral"}>
                      {pt.status[0]!.toUpperCase() + pt.status.slice(1)}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-muted">{date(pt.joined)}</td>
                  <td className="num px-5 py-3 text-right">{formatMoney(pt.revenue, pt.program.currency)}</td>
                  <td className="num px-5 py-3 text-right">{formatMoney(pt.earned, pt.program.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {partners.length ? null : <p className="px-5 py-6 text-[13px] text-muted">No partners yet.</p>}
        </Card>
      </Section>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Section title="Members">
          <Card>
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">{m.name}</span>
                    <span className="block truncate text-xs text-subtle">{m.email}</span>
                  </span>
                  <span className="flex flex-wrap justify-end gap-1.5">
                    <Badge className="capitalize">{m.role}</Badge>
                    {m.twoFactor ? <Badge tone="success">2FA</Badge> : null}
                    {m.verified ? null : <Badge tone="warning">Email not verified</Badge>}
                  </span>
                  <span className="hidden w-28 text-right text-xs text-subtle sm:block">
                    {m.lastActive ? `Active ${date(m.lastActive)}` : "Never signed in"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
        <Section title="History" description="The latest 25 changes in this workspace.">
          <Card>
            {events.length ? (
              <ul className="divide-y divide-border">
                {events.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-3 px-5 py-2.5 text-[13px]">
                    <span className="w-28 shrink-0 text-xs text-subtle">{when(e.createdAt)}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{e.action}</span>
                    <span className="shrink-0 text-xs text-muted capitalize">
                      {e.actorType.replace("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[13px] text-muted">No changes recorded yet.</p>
            )}
          </Card>
        </Section>
      </div>
    </>
  );
}
