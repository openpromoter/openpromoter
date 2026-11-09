import { emailLog, program } from "@openpromoter/db";
import { and, count, desc, eq, inArray, like, type SQL } from "drizzle-orm";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page";
import { listParams } from "@/lib/list";
import { requireAdmin } from "@/server/admin";
import { db } from "@/server/db";
import { EmailsTable } from "./table";

export const metadata: Metadata = { title: "Emails · Admin" };
export const dynamic = "force-dynamic";

const PROBLEMS = ["bounced", "complained", "failed", "not_sent"] as const;

/**
 * Every email the app sent in the last 30 days, newest first. Filtered and paged in the database: one page
 * of 50 rows and a count, through the created and address indexes.
 */
export default async function AdminEmails({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  await requireAdmin();
  const lp = listParams(await searchParams, 50);
  const q = lp.q
    .trim()
    .toLowerCase()
    .replace(/[%_\\]/g, "");
  const tab = lp.status ?? "all";
  const where: SQL | undefined = and(
    q ? like(emailLog.to, `${q}%`) : undefined,
    tab === "problems"
      ? inArray(emailLog.status, [...PROBLEMS])
      : tab === "delivered"
        ? eq(emailLog.status, "delivered")
        : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db()
      .select({
        id: emailLog.id,
        to: emailLog.to,
        subject: emailLog.subject,
        status: emailLog.status,
        detail: emailLog.detail,
        at: emailLog.createdAt,
        program: program.name,
        workspaceId: program.workspaceId,
      })
      .from(emailLog)
      .leftJoin(program, eq(program.id, emailLog.programId))
      .where(where)
      .orderBy(desc(emailLog.createdAt))
      .limit(lp.pageSize)
      .offset((lp.page - 1) * lp.pageSize),
    db().select({ n: count() }).from(emailLog).where(where),
  ]);
  return (
    <>
      <PageHeader
        title="Emails"
        description="Every email OpenPromoter sent in the last 30 days and what the mail provider reported. Bodies are never stored."
      />
      <EmailsTable
        rows={rows.map((r) => ({ ...r, at: r.at.toISOString() }))}
        total={total?.n ?? 0}
        page={lp.page}
        pageSize={lp.pageSize}
        tabs={[
          { label: "All", query: "" },
          { label: "Delivered", query: "status=delivered" },
          { label: "Problems", query: "status=problems" },
        ]}
      />
    </>
  );
}
