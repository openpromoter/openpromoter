import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { listParams } from "@/lib/list";
import { requireAdmin } from "@/server/admin";
import { adminUsers } from "@/server/admin-data";
import { UsersTable } from "../lists";

export const metadata: Metadata = { title: "Users · Admin" };
export const dynamic = "force-dynamic";

/** Every sign-in account: founders and partners, how they sign in, 2FA and when they were last here. */
export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireAdmin();
  const lp = listParams(await searchParams, 50);
  const { rows, total } = await adminUsers(lp.q, lp.page, lp.pageSize);
  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with an OpenPromoter sign-in: founders, their teams and partners. Newest first."
      />
      <UsersTable
        rows={rows.map((r) => ({
          ...r,
          twoFactor: !!r.twoFactor,
          createdAt: r.createdAt.toISOString(),
          lastActive: r.lastActive?.toISOString() ?? null,
        }))}
        total={total}
        page={lp.page}
        pageSize={lp.pageSize}
      />
    </>
  );
}
