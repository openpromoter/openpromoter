import { cn } from "@openpromoter/ui";
import Link from "next/link";
import { BRANDS, BrandIcon } from "@/components/brand";
import { LedgerLine } from "@/components/page";

export const METHOD_SHORT: Record<string, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
  wise: "Wise",
  manual: "Bank transfer",
};

/** The next payout as a slip: the figure, progress to the minimum in dots, a tear line, then the ledger. */
export function PayoutSlip({
  m,
  b,
  min,
  schedule,
  method,
  href,
  className,
}: {
  m: (n: number) => string;
  b: { approved: number; pending: number; held: number; paid: number };
  min: number;
  schedule: string;
  method: string | null;
  href?: string;
  className?: string;
}) {
  const reached = b.approved >= min;
  const filled = Math.round(Math.min(1, min ? b.approved / min : 1) * 24);
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-surface ", className)}>
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="eyebrow">Payout slip</span>
        <span className="eyebrow">{schedule}</span>
      </div>
      <div className="px-5 pt-4 pb-5">
        <div className="text-[13px] text-muted">Next payout</div>
        <div className="figure mt-1 text-[36px] leading-10 text-fg">{m(b.approved)}</div>
        <div className="mt-4 flex gap-[3px]" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i} className={cn("size-[5px] rounded-full", i < filled ? "bg-primary" : "bg-dot")} />
          ))}
        </div>
        <p className="mt-2 text-[13px] leading-5 text-subtle">
          {reached ? (
            <>
              Over the <b className="font-medium text-fg">{m(min)}</b> minimum and goes out in the next run
            </>
          ) : (
            <>
              <b className="font-medium text-fg">{m(Math.max(0, min - b.approved))}</b> more to reach the{" "}
              {m(min)} minimum
            </>
          )}
        </p>
      </div>
      <div className="perforated" aria-hidden />
      <div className="flex flex-col gap-2.5 px-5 pt-3 pb-4">
        <LedgerLine label="Approved" value={m(b.approved)} />
        <LedgerLine label="In refund window" value={m(b.pending)} />
        <LedgerLine label="On hold" value={m(b.held)} />
        <LedgerLine label="Paid all time" value={m(b.paid)} strong />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-2/60 px-5 py-2.5 text-xs">
        <span className="flex items-center gap-1.5 text-muted">
          {method && BRANDS[method] ? (
            <BrandIcon brand={method} size={12} />
          ) : (
            <span aria-hidden className={cn("size-1.5 rounded-full", method ? "bg-success" : "bg-warning")} />
          )}
          {method ? `Paid by ${METHOD_SHORT[method] ?? method}` : "No payout method yet"}
        </span>
        {href ? (
          <Link href={href} className="font-medium text-accent-text hover:underline">
            {method ? "Change" : "Add method"}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
