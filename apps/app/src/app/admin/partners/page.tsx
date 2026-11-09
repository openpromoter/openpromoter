import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { listParams } from "@/lib/list";
import { requireAdmin } from "@/server/admin";
import { adminPartners } from "@/server/admin-data";
import { PartnersTable } from "../lists";

export const metadata: Metadata = { title: "Partners · Admin" };
export const dynamic = "force-dynamic";

/** Every partner in every program: find the one who wrote to support, and the founder they belong to. */
export default async function AdminPartners({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireAdmin();
  const lp = listParams(await searchParams, 50);
  const { rows, total } = await adminPartners(lp.q, lp.page, lp.pageSize);
  return (
    <>
      <PageHeader
        title="Partners"
        description="Every partner in every program, newest first. Open one to see the founder's workspace."
      />
      <PartnersTable
        rows={rows.map((r) => ({ ...r, joined: r.joined.toISOString() }))}
        total={total}
        page={lp.page}
        pageSize={lp.pageSize}
      />
    </>
  );
}
