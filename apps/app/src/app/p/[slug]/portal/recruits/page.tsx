import { commission, partner } from "@openpromoter/db";
import { Card, CardHeader, EmptyState, StatusBadge } from "@openpromoter/ui";
import { UserPlus } from "@openpromoter/ui/icons";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { notFound } from "next/navigation";
import { CopyField } from "@/components/copy";
import { PageHeader } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";
import { baseAmount } from "@/server/fx";
import { programUrl } from "@/server/ref-link";

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Two-tier: the partner's recruit link and the partners who joined through it. */
export default async function PortalRecruits({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { program: p, partner: pt } = await partnerCtx(slug);
  if (p.overrideRate <= 0) notFound();
  const parent = alias(commission, "parent");
  const [subs, earned] = await Promise.all([
    db()
      .select({ id: partner.id, name: partner.name, status: partner.status, createdAt: partner.createdAt })
      .from(partner)
      .where(and(eq(partner.programId, p.id), eq(partner.recruitedBy, pt.id)))
      .orderBy(desc(partner.createdAt))
      .limit(500),
    db()
      .select({
        subId: parent.partnerId,
        // net of refund adjustments booked against each override (refund:<override id>:<key>)
        amount: sql<number>`coalesce(sum(${baseAmount} + (select coalesce(sum(round(a.amount * coalesce(a.fx_rate, 1))), 0) from ${commission} a where a.program_id = ${commission.programId} and a.source_key like 'refund:' || ${commission.id} || ':%')), 0)::int`,
      })
      .from(commission)
      .innerJoin(parent, eq(parent.id, commission.parentId))
      .where(
        and(
          eq(commission.partnerId, pt.id),
          eq(commission.kind, "override"),
          ne(commission.status, "reversed"),
        ),
      )
      .groupBy(parent.partnerId),
  ]);
  const bySub = new Map(earned.map((e) => [e.subId, e.amount]));
  const total = earned.reduce((s, e) => s + e.amount, 0);
  const rate = `${p.overrideRate / 100}%`;
  const url = `${programUrl(p, "/apply")}?recruit=${encodeURIComponent(pt.code)}`;
  return (
    <>
      <PageHeader
        title="Recruits"
        description={
          <>
            Bring other partners to {p.name}. You earn <b className="font-medium text-fg">{rate}</b> of every
            commission they earn. Your own commission stays the same.
          </>
        }
      />
      <Card>
        <CardHeader
          title="Your recruit link"
          description="Send it to people who could promote this product. Anyone who applies through it joins your team."
        />
        <div className="border-t border-border p-5">
          {pt.status === "approved" ? (
            <CopyField value={url} />
          ) : (
            <p className="text-[13px] text-muted">Your link appears here once your account is approved.</p>
          )}
        </div>
      </Card>
      <Card className="mt-4">
        <CardHeader
          title="Your team"
          description={`${subs.length} recruited ${subs.length === 1 ? "partner" : "partners"}. You've earned ${formatMoney(total, p.currency)} from their sales.`}
        />
        {subs.length ? (
          <ul className="divide-y divide-border border-t border-border">
            {subs.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-fg">{s.name}</span>
                <time className="hidden num text-[12px] text-subtle sm:block">Joined {day(s.createdAt)}</time>
                <StatusBadge status={s.status === "approved" ? "active" : s.status} />
                <span className="num w-24 shrink-0 text-right font-medium text-fg">
                  {formatMoney(bySub.get(s.id) ?? 0, p.currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={UserPlus}
            title="No recruits yet"
            description="Partners who apply through your recruit link show up here."
            className="border-t border-border"
          />
        )}
      </Card>
    </>
  );
}
