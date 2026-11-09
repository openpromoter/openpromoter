import { Button, Card, CardBody, CardHeader } from "@openpromoter/ui";
import { Banknote, Coins, Download, MousePointerClick, UserPlus } from "@openpromoter/ui/icons";
import type { Metadata } from "next";
import { BarChart, DotChart } from "@/components/charts";
import { PageHeader, Section, Stat } from "@/components/page";
import { RangePicker } from "@/components/range-picker";
import { TrafficPanels } from "@/components/traffic";
import { formatMoney, formatNumber, formatPercent } from "@/lib/money";
import {
  cohorts,
  delta,
  funnel,
  overview,
  parseRange,
  previous,
  timeseries,
  topPartners,
  topSources,
} from "@/server/analytics";
import { programCtx } from "@/server/context";
import { trafficReport } from "@/server/traffic";
import { ReportSubscribe } from "./subscribe";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({
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
  const r = parseRange({ days: String(days) });
  const m = (n: number) => formatMoney(n, prog.currency);
  const mw = (n: number) => formatMoney(n, prog.currency, { whole: true });
  const [cur, prev, series, prevSeries, steps, partners, sources, coh] = await Promise.all([
    overview(programId, r),
    overview(programId, previous(r)),
    timeseries(programId, r),
    timeseries(programId, previous(r)),
    funnel(programId, r),
    topPartners(programId, r, 10),
    topSources(programId, r, 8),
    cohorts(programId, 6),
  ]);
  const visitors = await trafficReport({ programId, from: r.from, to: r.to });
  const max = Math.max(1, steps[0]?.value ?? 1);
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Where partner revenue comes from, how it converts and how long it lasts."
        actions={
          <>
            <RangePicker days={days} base={`/app/${programId}/analytics`} />
            <Button asChild variant="secondary">
              <a href={`/api/export/analytics?program=${programId}&days=${days}`}>
                <Download /> Export
              </a>
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat
          icon={MousePointerClick}
          label="Clicks"
          value={formatNumber(cur.clicks)}
          delta={delta(cur.clicks, prev.clicks)}
        />
        <Stat
          icon={UserPlus}
          label="Signups"
          value={formatNumber(cur.leads)}
          delta={delta(cur.leads, prev.leads)}
        />
        <Stat
          icon={Coins}
          label="EPC"
          value={mw(Math.round(cur.epc))}
          delta={delta(cur.epc, prev.epc)}
          hint="Commission earned per click."
        />
        <Stat icon={Banknote} label="Paid out" value={mw(cur.paid)} sub={`${m(cur.owed)} owed`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Traffic and conversions" />
          <CardBody>
            <DotChart
              data={series}
              compare={prevSeries}
              compareLabel={`Previous ${days} days`}
              x="date"
              label={`Daily traffic and conversions over the last ${days} days`}
              series={[
                {
                  key: "clicks",
                  name: "Clicks",
                  total: formatNumber(cur.clicks),
                  delta: delta(cur.clicks, prev.clicks),
                },
                {
                  key: "leads",
                  name: "Signups",
                  total: formatNumber(cur.leads),
                  delta: delta(cur.leads, prev.leads),
                },
                {
                  key: "customers",
                  name: "Customers",
                  total: formatNumber(cur.customers),
                  delta: delta(cur.customers, prev.customers),
                },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Funnel"
            description={`${formatPercent(cur.conversionRate, 2)} of clicks become customers`}
          />
          <CardBody className="flex flex-col gap-3">
            {steps.map((s, i) => (
              <div key={s.step}>
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">{s.step}</span>
                  <span className="num font-medium text-fg">
                    {formatNumber(s.value)}{" "}
                    {i > 0 && steps[i - 1]!.value && s.value <= steps[i - 1]!.value ? (
                      <span className="text-xs font-normal text-subtle">
                        ({formatPercent(s.value / steps[i - 1]!.value, 1)})
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="relative mt-1.5 h-2.5">
                  <span
                    aria-hidden
                    className="absolute inset-0 bg-[radial-gradient(circle,var(--dot)_1.6px,transparent_1.8px)] bg-[length:6px_10px] bg-repeat-x"
                  />
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-[radial-gradient(circle,var(--chart-1)_1.6px,transparent_1.8px)] bg-[length:6px_10px] bg-repeat-x"
                    style={{ width: `${Math.max(2, (s.value / max) * 100)}%`, opacity: 1 - i * 0.18 }}
                  />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue by partner" />
          <CardBody>
            <BarChart
              data={partners.filter((p) => p.revenue > 0).map((p) => ({ name: p.name, revenue: p.revenue }))}
              x="name"
              y="revenue"
              name="Revenue"
              kind="money"
              currency={prog.currency}
              label="Revenue by partner"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Partner quality" description="EPC, conversion and LTV per customer" />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="px-5 pb-2 text-left font-medium">Partner</th>
                  <th className="px-3 pb-2 text-right font-medium">EPC</th>
                  <th className="px-3 pb-2 text-right font-medium">Conv.</th>
                  <th className="px-5 pb-2 text-right font-medium">LTV</th>
                </tr>
              </thead>
              <tbody>
                {partners
                  .filter((p) => p.clicks > 0 || p.lifetimeRevenue > 0)
                  .map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-5 py-2 text-fg">{p.name}</td>
                      <td className="num px-3 py-2 text-right">{m(Math.round(p.epc))}</td>
                      <td className="num px-3 py-2 text-right">{formatPercent(p.conversionRate, 1)}</td>
                      <td className="num px-5 py-2 text-right">{m(Math.round(p.ltv))}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Top sources and links"
            description="Where clicks that become customers come from"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="px-5 pb-2 text-left font-medium">Source</th>
                  <th className="px-3 pb-2 text-right font-medium">Clicks</th>
                  <th className="px-5 pb-2 text-right font-medium">Customers</th>
                </tr>
              </thead>
              <tbody>
                {sources.bySource.map((s) => (
                  <tr key={s.source} className="border-t border-border">
                    <td className="px-5 py-2 text-fg">{s.source}</td>
                    <td className="num px-3 py-2 text-right">{formatNumber(s.clicks)}</td>
                    <td className="num px-5 py-2 text-right">{s.customers}</td>
                  </tr>
                ))}
                {sources.byLink
                  .filter((l) => l.clicks > 0)
                  .slice(0, 5)
                  .map((l) => (
                    <tr key={l.key} className="border-t border-border">
                      <td className="px-5 py-2">
                        <span className="font-mono text-xs">/{l.key}</span>{" "}
                        <span className="text-subtle">{l.partner}</span>
                      </td>
                      <td className="num px-3 py-2 text-right">{l.clicks}</td>
                      <td className="num px-5 py-2 text-right">{l.customers}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Cohorts"
            description="Customers by month of first payment and how many still pay"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="px-5 pb-2 text-left font-medium">Month</th>
                  <th className="px-3 pb-2 text-right font-medium">Customers</th>
                  <th className="px-3 pb-2 text-right font-medium">Still active</th>
                  <th className="px-5 pb-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {coh.map((c) => (
                  <tr key={c.cohort} className="border-t border-border">
                    <td className="px-5 py-2 text-fg">{c.cohort}</td>
                    <td className="num px-3 py-2 text-right">{c.customers}</td>
                    <td className="num px-3 py-2 text-right">
                      <span
                        className="rounded-xs px-1.5 py-0.5"
                        style={{
                          background: `color-mix(in srgb, var(--primary) ${Math.round(c.retention * 40)}%, transparent)`,
                        }}
                      >
                        {formatPercent(c.retention, 0)}
                      </span>
                    </td>
                    <td className="num px-5 py-2 text-right">{m(c.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Section
        title="Visitors"
        description={`Where people who clicked partner links came from, in the last ${days} days. Humans only.`}
      >
        <TrafficPanels t={visitors} />
      </Section>
      <ReportSubscribe programId={programId} email={user.email} />
    </>
  );
}
