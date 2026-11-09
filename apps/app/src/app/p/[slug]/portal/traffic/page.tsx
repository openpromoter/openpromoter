import { Card } from "@openpromoter/ui";
import { MousePointerClick, Target, Users } from "@openpromoter/ui/icons";
import Link from "next/link";
import { DotChart } from "@/components/charts";
import { PageHeader, Stat } from "@/components/page";
import { TrafficPanels } from "@/components/traffic";
import { formatNumber } from "@/lib/money";
import { partnerCtx } from "@/server/context";
import { programBase } from "@/server/program-base";
import { trafficReport } from "@/server/traffic";

const RANGES = [7, 30, 90];

/** A partner's own visitors: how many, from where, on which device, and whether they became customers. */
export default async function PortalTraffic({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { slug } = await params;
  const days = RANGES.includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const { program: p, partner: pt } = await partnerCtx(slug);
  const home = await programBase(p);
  const to = new Date();
  const t = await trafficReport({
    programId: p.id,
    partnerId: pt.id,
    from: new Date(to.getTime() - days * 86_400_000),
    to,
  });
  const customers = t.days.reduce((a, d) => a + d.customers, 0);
  return (
    <>
      <PageHeader
        title="Traffic"
        description="Who clicks your links: where they come from, where they are and whether they buy."
        actions={
          <div className="flex rounded-md border border-border p-0.5 text-[13px]">
            {RANGES.map((d) => (
              <Link
                key={d}
                href={`${home}/portal/traffic${d === 30 ? "" : `?days=${d}`}`}
                aria-current={d === days ? "page" : undefined}
                className={`rounded-[5px] px-2.5 py-1 ${d === days ? "bg-surface-3 font-medium text-fg" : "text-muted hover:text-fg"}`}
              >
                {d} days
              </Link>
            ))}
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          icon={MousePointerClick}
          label="Clicks"
          value={formatNumber(t.clicks)}
          sub={`in the last ${days} days`}
        />
        <Stat
          icon={Users}
          label="Visitors"
          value={formatNumber(t.visitors)}
          sub="Different people who clicked"
        />
        <Stat
          icon={Target}
          label="Became customers"
          value={formatNumber(customers)}
          sub={`${t.visitors ? ((customers / t.visitors) * 100).toFixed(1) : "0.0"}% of visitors`}
        />
      </div>
      <Card className="mt-3 p-5">
        <h2 className="text-[14px] font-medium text-fg">Clicks per day</h2>
        <div className="mt-4">
          <DotChart
            data={t.days}
            x="day"
            series={[{ key: "clicks", name: "Clicks" }]}
            height={180}
            label="Clicks per day"
          />
        </div>
      </Card>
      <div className="mt-3">
        <TrafficPanels t={t} partnerView />
      </div>
    </>
  );
}
