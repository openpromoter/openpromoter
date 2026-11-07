"use client";

import { Avatar, Badge, Button, Checkbox, EmptyState, StatusBadge } from "@openpromoter/ui";
import { AlertTriangle, Banknote, Check, FileText, RotateCcw, X } from "@openpromoter/ui/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BrandIcon } from "@/components/brand";
import { mascotToast } from "@/components/mascot-toast";
import { formatMoney } from "@/lib/money";
import {
  approvePayoutsAction,
  cancelPayoutAction,
  markPaidAction,
  preparePayoutsAction,
  retryPayoutAction,
} from "../actions";

export function PrepareButton({ programId, disabled }: { programId: string; disabled: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="primary"
      disabled={disabled}
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await preparePayoutsAction(programId);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.data ? `${r.data} payouts ready for approval` : "Nobody is over the minimum yet");
          router.refresh();
        })
      }
    >
      <Banknote /> Prepare payouts
    </Button>
  );
}

type Q = {
  id: string;
  partnerId: string;
  name: string;
  email: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  failureReason: string | null;
  ready: boolean;
  test?: boolean;
};

export function ApprovalQueue({
  programId,
  canPay,
  rows,
  readyCount = 0,
}: {
  programId: string;
  canPay: boolean;
  rows: Q[];
  readyCount?: number;
}) {
  const waiting = rows.filter((r) => r.status === "awaiting_approval");
  // ready payouts start selected; the founder's clicks override that per row
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const sel = new Set(waiting.filter((r) => overrides[r.id] ?? r.ready).map((r) => r.id));
  const [pending, start] = useTransition();
  const router = useRouter();
  const total = waiting.filter((r) => sel.has(r.id)).reduce((a, r) => a + r.amount, 0);
  const cur = rows[0]?.currency ?? "usd";
  if (rows.length === 0 && readyCount > 0)
    return (
      <EmptyState
        icon={Banknote}
        mascot="payday"
        title={`${readyCount} partner${readyCount === 1 ? " is" : "s are"} ready to be paid`}
        description="Prepare the batch to review amounts and payout methods. Nothing is sent until you approve it."
        action={canPay ? <PrepareButton programId={programId} disabled={false} /> : undefined}
      />
    );
  if (rows.length === 0)
    return (
      <EmptyState
        icon={Banknote}
        mascot="resting"
        title="Nothing to pay out"
        description="Partners appear here once their approved balance passes your minimum."
        action={
          <Button asChild variant="secondary">
            <Link href={`/app/${programId}/commissions?status=approved`}>View commissions</Link>
          </Button>
        }
      />
    );
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? ok);
      router.refresh();
    });
  return (
    <div>
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            {r.status === "awaiting_approval" && canPay ? (
              <Checkbox
                checked={sel.has(r.id)}
                onCheckedChange={(v) => setOverrides((o) => ({ ...o, [r.id]: v === true }))}
                aria-label={`Select payout to ${r.name}`}
              />
            ) : null}
            <Avatar name={r.name} size={30} />
            <div className="min-w-0 flex-1">
              <Link
                href={`/app/${programId}/partners/${r.partnerId}`}
                className="text-[13px] font-medium text-fg hover:underline"
              >
                {r.name}
              </Link>
              <div className="truncate text-xs text-subtle">
                {r.email} ·{" "}
                <span>
                  <BrandIcon brand={r.method} size={12} className="mr-1 inline-block align-[-2px]" />
                  {(
                    { stripe: "Stripe", paypal: "PayPal", wise: "Wise", manual: "Manual" } as Record<
                      string,
                      string
                    >
                  )[r.method] ?? r.method}
                </span>
                {r.test ? <span className="text-warning"> · Test: mark paid by hand</span> : null}
                {!r.ready ? <span className="text-warning"> · payout details missing</span> : null}
                {r.failureReason ? (
                  // on a payout still processing it is a note from the provider, not an error
                  <span className={r.status === "failed" ? "text-danger" : "text-warning"}>
                    {" "}
                    · {r.failureReason}
                  </span>
                ) : null}
              </div>
            </div>
            <span className="hidden sm:inline-flex">
              <StatusBadge status={r.status} />
            </span>
            <span className="figure w-28 text-right text-[16px] text-fg">
              {formatMoney(r.amount, r.currency)}
            </span>
            {canPay ? (
              <div className="flex gap-1">
                {r.status === "processing" && r.method === "manual" ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      const ref = window.prompt("Payment reference (optional)") ?? undefined;
                      act(() => markPaidAction(programId, r.id, ref), "Marked as paid");
                    }}
                  >
                    <Check /> Mark paid
                  </Button>
                ) : null}
                {r.status === "failed" ? (
                  <Button
                    size="sm"
                    onClick={() => act(() => retryPayoutAction(programId, r.id), "Re-queued")}
                  >
                    <RotateCcw /> Retry
                  </Button>
                ) : null}
                {r.status === "awaiting_approval" ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Cancel payout"
                    onClick={() => act(() => cancelPayoutAction(programId, r.id), "Canceled")}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canPay && waiting.length ? (
        <div className="relative">
          <div aria-hidden className="perforated absolute -top-[5px] right-0 left-0" />
          <div className="border-t border-dashed border-border-strong" />
        </div>
      ) : null}
      {canPay && waiting.length ? (
        <div className="flex flex-col gap-4 bg-surface-2 px-5 py-5 sm:flex-row sm:items-end sm:justify-between md:rounded-b-xl">
          <div className="min-w-0 sm:w-72">
            <div className="flex items-baseline text-[13px]">
              <span className="text-muted">
                {sel.size} of {waiting.length} selected
              </span>
              <span className="leader" />
              <span className="num text-fg">{formatMoney(total, cur)}</span>
            </div>
            <div className="mt-1.5 flex items-baseline text-[13px]">
              <span className="text-muted">Fees from OpenPromoter</span>
              <span className="leader" />
              <span className="num text-fg">{formatMoney(0, cur)}</span>
            </div>
            <div className="eyebrow mt-4">Total to send</div>
            <div className="figure text-[32px] leading-10 text-fg">{formatMoney(total, cur)}</div>
          </div>
          <div className="flex items-center gap-3">
            {waiting.some((r) => !r.ready) ? (
              <Badge tone="warning" icon={AlertTriangle}>
                Some partners haven't added payout details
              </Badge>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              disabled={sel.size === 0}
              loading={pending}
              onClick={() => {
                if (
                  !window.confirm(
                    `Send ${formatMoney(total, cur)} to ${sel.size} partner${sel.size === 1 ? "" : "s"}? This moves real money.`,
                  )
                )
                  return;
                start(async () => {
                  let r = await approvePayoutsAction(programId, [...sel]);
                  if (!r.ok && r.error === "2FA_CODE_REQUIRED") {
                    const code = window.prompt(
                      "Large payout: enter the 6-digit code from your authenticator app",
                    );
                    if (!code) return;
                    r = await approvePayoutsAction(programId, [...sel], code);
                  }
                  if (!r.ok) return void toast.error(r.error);
                  const res = r.data ?? [];
                  const failed = res.filter((x) => x.status === "failed");
                  failed.length
                    ? toast.error(`${failed.length} failed: ${failed[0]?.error}`)
                    : mascotToast(`${res.length} payouts approved`, "payday");
                  router.refresh();
                });
              }}
            >
              <Check /> Approve {sel.size} payout{sel.size === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type H = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  invoice: string | null;
  paidAt: string | null;
  externalId: string | null;
};

export function PayoutHistory({ programId, rows }: { programId: string; rows: H[] }) {
  if (!rows.length)
    return <p className="border-t border-border px-5 py-6 text-[13px] text-muted">No payouts yet.</p>;
  return (
    <ul className="divide-y divide-border border-t border-border">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
          <StatusBadge status={r.status} />
          <span className="min-w-0 flex-1 truncate text-fg">{r.name}</span>
          <span className="hidden text-xs text-subtle sm:inline">
            {r.method}
            {r.externalId ? ` · ${r.externalId}` : ""}
          </span>
          <span className="text-xs text-subtle">
            {r.paidAt ? new Date(r.paidAt).toLocaleDateString("en-US", { dateStyle: "medium" }) : "–"}
          </span>
          <span className="num w-24 text-right text-fg">{formatMoney(r.amount, r.currency)}</span>
          {r.status === "paid" ? (
            <Button asChild size="icon-sm" variant="ghost" aria-label="Invoice">
              <Link href={`/app/${programId}/payouts/${r.id}/invoice`}>
                <FileText />
              </Link>
            </Button>
          ) : (
            <span className="w-7" />
          )}
        </li>
      ))}
    </ul>
  );
}
