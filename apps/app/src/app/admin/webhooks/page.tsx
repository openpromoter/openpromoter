import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { listParams } from "@/lib/list";
import { requireAdmin } from "@/server/admin";
import { adminWebhooks } from "@/server/admin-data";
import { WebhooksTable } from "../lists";

export const metadata: Metadata = { title: "Webhooks · Admin" };
export const dynamic = "force-dynamic";

/** Founders' webhook, Slack and Discord deliveries that failed in the last 7 days, with the answer we got. */
export default async function AdminWebhooks({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireAdmin();
  const lp = listParams(await searchParams, 50);
  const { rows, total } = await adminWebhooks(lp.page, lp.pageSize);
  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Deliveries to founders' webhooks, Slack and Discord that failed in the last 7 days. A founder's own endpoint answering with an error is usually theirs to fix."
      />
      <WebhooksTable
        rows={rows.map((r) => ({ ...r, at: r.at.toISOString() }))}
        total={total}
        page={lp.page}
        pageSize={lp.pageSize}
      />
    </>
  );
}
