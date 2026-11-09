import { Card, CardHeader } from "@openpromoter/ui";
import { formatNumber } from "@/lib/money";
import type { TrafficReport } from "@/server/traffic";

/**
 * Visitor breakdowns, shared by the founder's analytics and partner pages and the partner's own Traffic
 * page: where visits come from, countries, devices, landing pages, sub-IDs and the latest visits.
 */
const regions = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (c: string) => {
  try {
    return regions.of(c) ?? c;
  } catch {
    return c;
  }
};
const ago = (d: Date) => {
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function Breakdown({
  title,
  description,
  rows,
  label = (k: string) => k,
  empty,
}: {
  title: string;
  description?: string;
  rows: { key: string; clicks: number; customers: number }[];
  label?: (k: string) => string;
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.clicks));
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {rows.length ? (
        <ul className="flex flex-col gap-1 px-5 pb-5">
          <li className="flex text-xs text-subtle">
            <span className="flex-1" />
            <span className="w-16 text-right">Clicks</span>
            <span className="w-20 text-right">Customers</span>
          </li>
          {rows.map((r) => (
            <li key={r.key} className="relative flex items-center py-1.5 text-[13px]">
              <span
                aria-hidden
                className="absolute inset-y-0.5 left-0 rounded-[3px] bg-accent-soft"
                style={{ width: `${Math.max(2, (r.clicks / max) * 70)}%` }}
              />
              <span className="relative min-w-0 flex-1 truncate pl-2 text-fg">{label(r.key)}</span>
              <span className="num relative w-16 text-right">{formatNumber(r.clicks)}</span>
              <span className="num relative w-20 text-right text-muted">{formatNumber(r.customers)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-5 text-[13px] text-muted">{empty}</p>
      )}
    </Card>
  );
}

export function TrafficPanels({ t, partnerView = false }: { t: TrafficReport; partnerView?: boolean }) {
  const none = partnerView ? "Share your link to see your visitors here." : "No visits in this period yet.";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Breakdown
          title="Where visitors come from"
          description="The site that sent them, or the utm_source tag on the link"
          rows={t.sources}
          empty={none}
        />
        <Breakdown title="Countries" rows={t.countries} label={countryName} empty={none} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Breakdown title="Devices" rows={t.devices} empty={none} />
        <Breakdown title="Landing pages" rows={t.pages} empty={none} />
        <Breakdown
          title="Sub-IDs"
          description="Add ?sub= to a link to tell placements apart"
          rows={t.subIds}
          empty="No sub-IDs used yet."
        />
      </div>
      <Card>
        <CardHeader
          title="Latest visits"
          description="The newest clicks on these links. No personal data is kept."
        />
        {t.recent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="text-left text-xs text-subtle">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 font-normal">When</th>
                  <th className="px-3 py-2 font-normal">From</th>
                  <th className="px-3 py-2 font-normal">Country</th>
                  <th className="px-3 py-2 font-normal">Device</th>
                  <th className="px-3 py-2 font-normal">Landed on</th>
                  <th className="px-5 py-2 font-normal">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {t.recent.map((v, i) => (
                  <tr key={`${v.at.toISOString()}-${i}`}>
                    <td className="px-5 py-2.5 text-muted">{ago(v.at)}</td>
                    <td className="max-w-48 truncate px-3 py-2.5 text-fg">{v.source}</td>
                    <td className="px-3 py-2.5 text-muted">
                      {v.country ? countryName(v.country) : "Unknown"}
                    </td>
                    <td className="px-3 py-2.5 text-muted">{v.device}</td>
                    <td className="max-w-56 truncate px-3 py-2.5 font-mono text-xs text-muted">
                      {v.page}
                      {v.key ? <span className="text-subtle"> · /{v.key}</span> : null}
                    </td>
                    <td className="px-5 py-2.5">
                      {v.customer ? (
                        <span className="text-success">Became a customer</span>
                      ) : (
                        <span className="text-subtle">Visited</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 pb-5 text-[13px] text-muted">{none}</p>
        )}
      </Card>
    </div>
  );
}
