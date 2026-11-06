import { billingConnection, type program } from "@openpromoter/db";
import { cn } from "@openpromoter/ui";
import { eq } from "drizzle-orm";
import { formatMoney } from "@/lib/money";
import { rateLabel } from "@/lib/program-labels";
import { db } from "@/server/db";

type P = typeof program.$inferSelect;

export const termLabel = (p: P) =>
  p.commissionDuration === "lifetime"
    ? "Lifetime of the customer"
    : p.commissionDuration === "months"
      ? `${p.commissionMonths} months per customer`
      : "First payment only";

export const scheduleLabel = (p: P) =>
  p.payoutSchedule === "manual" ? "Regularly" : p.payoutSchedule === "weekly" ? "Weekly" : "Monthly";

const METHOD: Record<string, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
  wise: "Wise",
  manual: "bank transfer",
};

/** The commission offer set like a statement: label ······ figure, then a worked example under a tear line. */
export async function OfferStatement({ p, className }: { p: P; className?: string }) {
  const example = 10_000;
  const earns =
    p.commissionType === "percent" ? Math.round((example * p.commissionValue) / 10_000) : p.commissionValue;
  const rows: [string, string][] = [
    ["Paid for", termLabel(p)],
    ["Cookie window", `${p.cookieDays} days`],
    ["Refund window", `${p.holdDays} days`],
    ["Payouts", `${scheduleLabel(p)} from ${formatMoney(p.minPayout, p.currency)}`],
    ...(p.doubleSided.enabled
      ? ([
          ["Your audience gets", `${p.doubleSided.percentOff}% off for ${p.doubleSided.durationMonths} mo`],
        ] as [string, string][])
      : []),
  ];
  // only the providers the founder actually connected; bank transfer is always possible
  const conns = await db()
    .select({ provider: billingConnection.provider, secret: billingConnection.secretEnc })
    .from(billingConnection)
    .where(eq(billingConnection.workspaceId, p.workspaceId));
  const live = p.payoutMethods.filter(
    (m) => m === "manual" || conns.some((c) => c.provider === m && c.secret),
  );
  const methods = (live.length ? live : ["manual"]).map((m) => METHOD[m] ?? m);
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-surface ", className)}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="eyebrow">Commission statement</span>
        <span className="eyebrow">{p.currency}</span>
      </div>
      <div className="px-5 pt-5 pb-4">
        <div className="text-[13px] text-muted">You earn</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="figure text-[44px] leading-[48px] text-fg">{rateLabel(p)}</span>
          <span className="text-[13px] text-subtle">
            {p.commissionType === "percent" ? "of every payment" : "per customer"}
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-2.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline text-[13px]">
              <span className="text-muted">{k}</span>
              <span className="leader" aria-hidden />
              <span className="num text-right text-fg">{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="perforated" aria-hidden />
      <div className="bg-surface-2/70 px-5 pt-3 pb-4 dark:bg-surface-2">
        <div className="eyebrow">Example</div>
        <div className="mt-2 flex items-baseline text-[13px]">
          <span className="text-muted">A {formatMoney(example, p.currency)} payment pays you</span>
          <span className="leader" aria-hidden />
          <span className="num font-medium text-fg">{formatMoney(earns, p.currency)}</span>
        </div>
        <p className="mt-2 text-xs leading-4 text-subtle">
          Paid by{" "}
          {methods.length > 1 ? `${methods.slice(0, -1).join(", ")} or ${methods.at(-1)}` : methods[0]}.
        </p>
      </div>
    </div>
  );
}
