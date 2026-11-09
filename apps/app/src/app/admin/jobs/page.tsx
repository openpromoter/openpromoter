import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { listParams } from "@/lib/list";
import { requireAdmin } from "@/server/admin";
import { adminJobs } from "@/server/admin-data";
import { JobsTable } from "../lists";

export const metadata: Metadata = { title: "Jobs · Admin" };
export const dynamic = "force-dynamic";

/**
 * Background work: emails, payouts, webhooks, imports and scheduled tasks. Failed jobs keep their last
 * error; a job waiting more than 5 minutes past its time means the worker is behind.
 */
export default async function AdminJobs({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireAdmin();
  const lp = listParams(await searchParams, 50);
  const tab = lp.status === "waiting" || lp.status === "failed" ? lp.status : "done";
  const { rows, total, late, failed24 } = await adminJobs(tab, lp.page, lp.pageSize);
  return (
    <>
      <PageHeader
        title="Jobs"
        description={`Background work. ${late ? `${late} waiting longer than 5 minutes.` : "Nothing is running late."} ${failed24 ? `${failed24} failed in the last 24 hours.` : "Nothing failed in the last 24 hours."}`}
      />
      <JobsTable
        rows={rows.map((r) => ({
          ...r,
          runAt: r.runAt.toISOString(),
          doneAt: r.doneAt?.toISOString() ?? null,
          failedAt: r.failedAt?.toISOString() ?? null,
        }))}
        total={total}
        page={lp.page}
        pageSize={lp.pageSize}
        tabs={[
          { label: "Finished", query: "" },
          { label: "Waiting", query: "status=waiting" },
          { label: "Failed", query: "status=failed" },
        ]}
      />
    </>
  );
}
