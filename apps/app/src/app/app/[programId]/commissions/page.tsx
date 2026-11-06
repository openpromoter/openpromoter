import { commission, partner } from "@openpromoter/db";
import { Badge, Card, cn, StatusBadge } from "@openpromoter/ui";
import {
  ArrowRight,
  BadgeCheck,
  Calendar,
  Clock,
  LayoutDashboard,
  PauseCircle,
  Receipt,
} from "@openpromoter/ui/icons";
import { and, asc, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/page";
import { like, listParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { CommissionsTable, ManualCommission } from "./table";

export const metadata: Metadata = { title: "Commissions" };

export default async function CommissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ programId: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { programId } = await params;
  const sp = await searchParams;
  const { program: prog, role } = await programCtx(programId);
  const lp = listParams(sp);
  const where: SQL[] = [
    eq(commission.programId, programId),
    sql`not (${commission.kind} = 'adjustment' and ${commission.amount} = 0)`,
  ];
  if (lp.status) where.push(eq(commission.status, lp.status as "pending"));
  if (lp.partner) where.push(eq(commission.partnerId, lp.partner));
  if (sp.kind) where.push(eq(commission.kind, sp.kind as "sale"));
  if (lp.q)
    where.push(
      or(
        ilike(partner.name, like(lp.q)),
        ilike(commission.description, like(lp.q)),
        ilike(commission.id, like(lp.q)),
      )!,
    );
  const sortCol =
    { amount: commission.amount, createdAt: commission.createdAt, holdUntil: commission.holdUntil }[
      lp.sort?.key ?? "createdAt"
    ] ?? commission.createdAt;
  const [rows, [count], totals, partners] = await Promise.all([
    db()
      .select({
        id: commission.id,
        partnerId: partner.id,
        partnerName: partner.name,
        kind: commission.kind,
        description: commission.description,
        saleAmount: commission.saleAmount,
        amount: commission.amount,
        currency: commission.currency,
        status: commission.status,
        heldReason: commission.heldReason,
        holdUntil: commission.holdUntil,
        createdAt: commission.createdAt,
        payoutId: commission.payoutId,
        test: commission.test,
      })
      .from(commission)
      .innerJoin(partner, eq(partner.id, commission.partnerId))
      .where(and(...where))
      .orderBy(lp.sort?.dir === "asc" ? asc(sortCol) : desc(sortCol))
      .limit(lp.pageSize)
      .offset((lp.page - 1) * lp.pageSize),
    // with no search/partner/kind filter the per-status totals below already hold the count: skip the scan
    lp.q || lp.partner || sp.kind
      ? db()
          .select({ n: sql<number>`count(*)::int` })
          .from(commission)
          .innerJoin(partner, eq(partner.id, commission.partnerId))
          .where(and(...where))
      : Promise.resolve([] as { n: number }[]),
    db()
      .select({
        s: commission.status,
        n: sql<number>`count(*)::int`,
        sum: sql<number>`coalesce(sum(${commission.amount}),0)::bigint`,
      })
      .from(commission)
      .where(
        and(
          eq(commission.programId, programId),
          sql`not (${commission.kind} = 'adjustment' and ${commission.amount} = 0)`,
        ),
      )
      .groupBy(commission.status),
    db()
      .select({ id: partner.id, name: partner.name })
      .from(partner)
      .where(and(eq(partner.programId, programId), eq(partner.status, "approved")))
      .orderBy(partner.name)
      .limit(500),
  ]);
  const t = (s: string) => totals.find((x) => x.s === s);
  const m = (n: number) => formatMoney(Number(n), prog.currency);
  const board = sp.view === "board";
  const base = `/app/${programId}/commissions`;
  const COLS = [
    { s: "pending", label: "Pending", icon: Clock, note: "In the refund window" },
    { s: "approved", label: "Approved", icon: BadgeCheck, note: "Joins the next payout" },
    { s: "held", label: "Held", icon: PauseCircle, note: "Waiting for your review" },
    { s: "paid", label: "Paid", icon: Receipt, note: "Sent to partners" },
  ] as const;
  const cards = board
    ? await Promise.all(
        COLS.map((c) =>
          db()
            .select({
              id: commission.id,
              partnerId: partner.id,
              partnerName: partner.name,
              kind: commission.kind,
              description: commission.description,
              amount: commission.amount,
              saleAmount: commission.saleAmount,
              heldReason: commission.heldReason,
              holdUntil: commission.holdUntil,
              createdAt: commission.createdAt,
            })
            .from(commission)
            .innerJoin(partner, eq(partner.id, commission.partnerId))
            .where(and(eq(commission.programId, programId), eq(commission.status, c.s)))
            .orderBy(desc(commission.createdAt))
            .limit(6),
        ),
      )
    : [];
  const day = (d: Date | null) =>
    d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const viewToggle = (
    <div
      role="group"
      aria-label="View"
      className="flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-border ring-inset"
    >
      {[
        ["List", base, !board],
        ["Board", `${base}?view=board`, board],
      ].map(([l, href, on]) => (
        <Link
          key={String(l)}
          href={String(href)}
          aria-current={on ? "true" : undefined}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
            on ? "bg-surface text-fg dark:bg-surface-3" : "text-subtle hover:text-fg",
          )}
        >
          {l === "Board" ? <LayoutDashboard className="size-3.5" /> : null}
          {String(l)}
        </Link>
      ))}
    </div>
  );
  return (
    <>
      <AutoRefresh />
      <PageHeader
        title="Commissions"
        description="Commissions in this ledger stay pending through the refund window. After that they are approved and join the next payout. Refunds and chargebacks reverse them automatically."
        actions={
          <>
            {viewToggle}
            {role !== "viewer" ? (
              <ManualCommission programId={programId} partners={partners} currency={prog.currency} />
            ) : null}
          </>
        }
      />
      {board ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLS.map((c, ci) => (
            <section
              key={c.s}
              className="flex flex-col rounded-xl bg-surface-2 p-1.5 ring-1 ring-border ring-inset"
            >
              <header className="flex items-center gap-2 px-2.5 pt-2 pb-2.5">
                <c.icon className="size-4 text-subtle" />
                <h2 className="text-[13px] font-medium text-fg">{c.label}</h2>
                <span className="num rounded-[4px] bg-surface px-1.5 text-[11px] leading-[18px] font-medium text-muted ring-1 ring-border">
                  {t(c.s)?.n ?? 0}
                </span>
                <span className="figure ml-auto text-[13px] text-fg">{m(t(c.s)?.sum ?? 0)}</span>
              </header>
              <ul className="flex flex-col gap-1.5">
                {cards[ci]!.map((x) => (
                  <li key={x.id}>
                    <Card className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span className="eyebrow">
                          {x.kind === "sale" ? "Sale" : x.kind === "override" ? "Override" : x.kind}
                        </span>
                        <span className="ml-auto">
                          {c.s === "held" ? (
                            <Badge tone="warning" dot>
                              Review
                            </Badge>
                          ) : (
                            <StatusBadge status={c.s} />
                          )}
                        </span>
                      </div>
                      <Link
                        href={`/app/${programId}/partners/${x.partnerId}`}
                        className="mt-2 block truncate text-[13px] text-muted hover:text-fg"
                      >
                        {x.partnerName}
                      </Link>
                      <div
                        className={cn(
                          "figure text-[22px] leading-7",
                          x.amount < 0 ? "text-danger" : "text-fg",
                        )}
                      >
                        {x.amount < 0 ? `−${m(-x.amount)}` : m(x.amount)}
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5 text-xs text-subtle">
                        <Calendar className="size-3.5" />
                        <span>{day(x.createdAt)}</span>
                        <span className="ml-auto truncate">
                          {c.s === "pending" && x.holdUntil
                            ? `Payable ${day(x.holdUntil)}`
                            : c.s === "held"
                              ? (x.heldReason ?? "Held")
                              : x.saleAmount
                                ? `on ${m(x.saleAmount)}`
                                : (x.description ?? "")}
                        </span>
                      </div>
                    </Card>
                  </li>
                ))}
                {cards[ci]!.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-xs text-subtle">
                    {c.note}
                  </li>
                ) : null}
              </ul>
              {(t(c.s)?.n ?? 0) > cards[ci]!.length ? (
                <Link
                  href={`${base}?status=${c.s}`}
                  className="mt-1.5 flex h-8 items-center justify-center gap-1 rounded-lg text-xs text-muted hover:bg-surface hover:text-fg"
                >
                  All {t(c.s)?.n} <ArrowRight className="size-3.5" />
                </Link>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
      {board ? null : (
        <CommissionsTable
          programId={programId}
          canWrite={role !== "viewer"}
          rows={rows.map((r) => ({
            ...r,
            holdUntil: r.holdUntil?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          }))}
          total={
            count?.n ??
            totals.filter((x) => (lp.status ? x.s === lp.status : true)).reduce((a, x) => a + x.n, 0)
          }
          page={lp.page}
          pageSize={lp.pageSize}
          tabs={[
            { label: "All", query: "" },
            { label: "Pending", query: "status=pending", count: t("pending")?.n ?? 0 },
            { label: "Approved", query: "status=approved", count: t("approved")?.n ?? 0 },
            { label: "Held", query: "status=held", count: t("held")?.n ?? 0 },
            { label: "Paid", query: "status=paid", count: t("paid")?.n ?? 0 },
            { label: "Reversed", query: "status=reversed", count: t("reversed")?.n ?? 0 },
          ]}
        />
      )}
    </>
  );
}
