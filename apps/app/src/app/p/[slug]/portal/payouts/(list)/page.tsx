import { billingConnection, payout } from "@openpromoter/db";
import { Card, CardHeader, EmptyState, StatusBadge } from "@openpromoter/ui";
import { Banknote, FileText } from "@openpromoter/ui/icons";
import { and, desc, eq } from "drizzle-orm";
import { BrandIcon } from "@/components/brand";
import { PageHeader } from "@/components/page";
import { formatMoney } from "@/lib/money";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";
import { balances } from "@/server/ledger";
import { programBase } from "@/server/program-base";
import { refreshPartnerStripe } from "@/server/stripe-service";
import { scheduleLabel } from "../../../offer";
import { METHOD_SHORT, PayoutSlip } from "../../slip";
import { PayoutMethod } from "../client";

export default async function PortalPayouts({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ stripe?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await partnerCtx(slug);
  const home = await programBase(ctx.program);
  let pt = ctx.partner;
  if (sp.stripe === "return" && pt.stripeAccountId) {
    await refreshPartnerStripe(pt.id);
    pt = (await partnerCtx(slug)).partner;
  }
  const conns = await db()
    .select({ provider: billingConnection.provider, secret: billingConnection.secretEnc })
    .from(billingConnection)
    .where(eq(billingConnection.workspaceId, ctx.program.workspaceId));
  // a provider is offered only when the founder connected it with credentials; manual bank transfer is always possible
  const methods = [
    ...ctx.program.payoutMethods.filter(
      (m) => m !== "manual" && conns.some((c) => c.provider === m && c.secret),
    ),
    "manual",
  ];
  const rows = await db()
    .select()
    .from(payout)
    .where(and(eq(payout.partnerId, pt.id)))
    .orderBy(desc(payout.createdAt));
  const p = ctx.program;
  const m = (n: number) => formatMoney(n, p.currency);
  const b = (await balances(p.id, [pt.id])).find((x) => x.currency === p.currency) ?? {
    approved: 0,
    pending: 0,
    held: 0,
    paid: 0,
  };
  return (
    <>
      <PageHeader
        title="Payouts"
        description={
          <>
            Payouts go out {scheduleLabel(p).toLowerCase()} once you're owed{" "}
            <b className="font-medium text-fg">{m(p.minPayout)}</b> and the {p.holdDays}-day refund window has
            passed.
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <PayoutMethod
          slug={slug}
          methods={methods}
          current={pt.payoutMethod}
          paypal={pt.paypalEmail}
          wise={pt.wiseEmail}
          stripeReady={pt.stripePayoutsEnabled}
          stripeStarted={!!pt.stripeAccountId}
          min={m(p.minPayout)}
        />
        <PayoutSlip m={m} b={b} min={p.minPayout} schedule={scheduleLabel(p)} method={pt.payoutMethod} />
      </div>
      <Card className="mt-4">
        <CardHeader title="History" description="Paid payouts come with a self-billed invoice." />
        {rows.length ? (
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                <time className="w-24 shrink-0 font-mono text-[12px] text-subtle">
                  {(r.paidAt ?? r.createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
                </time>
                <span className="flex min-w-0 flex-1 items-baseline">
                  <span className="truncate text-fg">
                    <BrandIcon brand={r.method} size={13} className="mr-1.5 inline-block align-[-2px]" />
                    {METHOD_SHORT[r.method] ?? r.method}
                    {r.invoiceNumber ? (
                      <span className="font-mono text-[12px] text-subtle"> · {r.invoiceNumber}</span>
                    ) : null}
                  </span>
                  <span className="leader hidden sm:block" aria-hidden />
                </span>
                <span className="hidden sm:inline-flex">
                  <StatusBadge status={r.status === "awaiting_approval" ? "processing" : r.status} />
                </span>
                <span className="num w-24 shrink-0 text-right font-medium text-fg">
                  {formatMoney(r.amount, r.currency)}
                </span>
                <span className="w-16 shrink-0 text-right">
                  {r.status === "paid" ? (
                    <a
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline"
                      href={`${home}/portal/payouts/${r.id}`}
                    >
                      <FileText className="size-3.5" /> Invoice
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Banknote}
            title="No payouts yet"
            description="Your first payout and its invoice show up here as soon as it's sent."
            className="border-t border-border"
          />
        )}
      </Card>
    </>
  );
}
