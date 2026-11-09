import { job, webhookDelivery } from "@openpromoter/db";
import { and, count, eq, gte, isNull, lt, or } from "drizzle-orm";
import type { Metadata } from "next";
import { requireAdmin } from "@/server/admin";
import { emailProblems } from "@/server/admin-data";
import { db } from "@/server/db";
import { AdminShell } from "./shell";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const DAY = 86_400_000;

/** The owner's console. The sidebar badges count what needs the owner (each read through an index). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requireAdmin();
  const now = Date.now();
  const [emails, [jobs], [hooks]] = await Promise.all([
    emailProblems(),
    db()
      .select({ n: count() })
      .from(job)
      .where(
        or(
          gte(job.failedAt, new Date(now - DAY)),
          and(isNull(job.doneAt), isNull(job.failedAt), lt(job.runAt, new Date(now - 5 * 60_000))),
        ),
      ),
    db()
      .select({ n: count() })
      .from(webhookDelivery)
      .where(and(eq(webhookDelivery.status, "failed"), gte(webhookDelivery.createdAt, new Date(now - DAY)))),
  ]);
  return (
    <AdminShell email={u.email} alerts={{ emails, jobs: jobs?.n ?? 0, webhooks: hooks?.n ?? 0 }}>
      {children}
    </AdminShell>
  );
}
