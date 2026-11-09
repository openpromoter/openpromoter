import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { listParams } from "@/lib/list";
import { requireAdmin } from "@/server/admin";
import { adminActivity } from "@/server/admin-data";
import { ActivityTable } from "../lists";

export const metadata: Metadata = { title: "Activity · Admin" };
export const dynamic = "force-dynamic";

const TABS = [
  { label: "All", query: "" },
  { label: "Plans", query: "status=plan." },
  { label: "Billing", query: "status=billing." },
  { label: "Partners", query: "status=partner." },
  { label: "Payouts", query: "status=payout" },
  { label: "Programs", query: "status=program." },
];

/** A short line for the audit data, never more than a few fields (no secrets are ever stored there). */
function summary(data: unknown) {
  if (!data || typeof data !== "object") return "";
  return Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

/** Every change in every workspace, newest first: who did what and when. */
export default async function AdminActivity({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireAdmin();
  const lp = listParams(await searchParams, 50);
  const { rows, total } = await adminActivity(lp.status, lp.page, lp.pageSize);
  return (
    <>
      <PageHeader
        title="Activity"
        description="Every change across all workspaces: settings, partners, payouts and plans. Newest first."
      />
      <ActivityTable
        rows={rows.map((r) => ({ ...r, at: r.at.toISOString(), summary: summary(r.data) }))}
        total={total}
        page={lp.page}
        pageSize={lp.pageSize}
        tabs={TABS}
      />
    </>
  );
}
