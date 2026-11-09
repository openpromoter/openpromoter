import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { listParams } from "@/lib/list";
import { adminWorkspacesCached, attention, requireAdmin } from "@/server/admin";
import { WorkspacesTable } from "../table";

export const metadata: Metadata = { title: "Workspaces · Admin" };
export const dynamic = "force-dynamic";

/** Every customer workspace: search, filter by paying, free or needing the owner. */
export default async function AdminWorkspaces({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const lp = listParams(sp, 25);
  const { rows } = await adminWorkspacesCached(sp.fresh === "1");
  const flagged = rows.filter((w) => attention(w).length);
  const tab = lp.status ?? "all";
  const q = lp.q.toLowerCase();
  const shown = rows
    .filter((w) =>
      tab === "paying"
        ? w.paying
        : tab === "free"
          ? !w.paying
          : tab === "attention"
            ? attention(w).length > 0
            : true,
    )
    .filter((w) => !q || `${w.name} ${w.owner ?? ""} ${w.id}`.toLowerCase().includes(q));
  const page = shown.slice((lp.page - 1) * lp.pageSize, lp.page * lp.pageSize);
  return (
    <>
      <PageHeader
        title="Workspaces"
        description="Every customer on OpenPromoter Cloud. Search by name, owner email or ID, and open one for its programs, partners and history."
      />
      <WorkspacesTable
        rows={page.map((w) => ({
          id: w.id,
          name: w.name,
          owner: w.owner,
          plan: w.plan.name,
          status: w.status,
          paying: w.paying,
          done: w.done,
          partners: w.partners,
          usage: w.usage,
          usageShare: w.usageShare,
          lastActive: w.lastActive?.toISOString() ?? null,
          createdAt: w.createdAt.toISOString(),
          flags: attention(w).map((x) => x.text),
        }))}
        total={shown.length}
        page={lp.page}
        pageSize={lp.pageSize}
        tabs={[
          { label: "All", query: "", count: rows.length },
          { label: "Paying", query: "status=paying", count: rows.filter((w) => w.paying).length },
          { label: "Free", query: "status=free", count: rows.filter((w) => !w.paying).length },
          { label: "Needs you", query: "status=attention", count: flagged.length },
        ]}
      />
    </>
  );
}
