"use client";
import { Button, Checkbox, cn, Textarea } from "@openpromoter/ui";
import { Upload } from "@openpromoter/ui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import { importAction } from "../../settings-actions";

type Kind = "partners" | "referrals" | "balances";
type Result = { created: number; skipped: number; columns: string[]; notes: string[] };

const KINDS: {
  kind: Kind;
  label: string;
  sample: string;
  about: (currency: string) => string;
  columns: (param: string) => string;
  done: (n: number) => string;
}[] = [
  {
    kind: "partners",
    label: "Partners",
    sample:
      "email,name,referral_code,coupon_code,paypal_email\nmaya@example.com,Maya Chen,maya,MAYA20,maya@example.com",
    about: () =>
      "Partners keep their referral codes. Links already shared keep working because op.js still reads ?via=, ?fpr=, ?ref=, ?gspk= and Lemon Squeezy's ?aff=.",
    columns: (param) =>
      `Recognized columns: email, name or first and last name, referral code (token, ref_id, slug, partner_key…), the old tool's partner ID, status, coupon, PayPal or Wise email, website and country. Your program link parameter is ?${param}=.`,
    done: (n) => `${n} ${n === 1 ? "partner" : "partners"} imported`,
  },
  {
    kind: "referrals",
    label: "Referred customers",
    sample:
      "partner_email,stripe_customer_id,customer_email,status\nmaya@example.com,cus_Q1w2E3,lee@example.com,active",
    about: () =>
      "Each row needs the partner's email, code or old partner ID, plus the customer's billing ID or email. Renewals from these customers keep paying the same partner.",
    columns: () =>
      "Recognized columns: partner email, partner ID or referral code, customer ID (stripe_customer_id, provider_key, uid…), customer email, name, status and converted date.",
    done: (n) => `${n} ${n === 1 ? "customer" : "customers"} imported`,
  },
  {
    kind: "balances",
    label: "Balances",
    sample: "partner_email,unpaid,total_paid\nmaya@example.com,120.00,900.00",
    about: (currency) =>
      `Use one row per partner with unpaid and paid amounts, or a list of commissions with an amount and a status. Amounts must be in ${currency.toUpperCase()}. Unpaid amounts go into the next payout.`,
    columns: () =>
      "Recognized columns: partner email, partner ID or referral code, unpaid (balance, amount_due…), pending, paid (total_paid, paid_out…), or amount with status and currency.",
    done: (n) => `Balances imported for ${n} ${n === 1 ? "partner" : "partners"}`,
  },
];

export function ImportForm({
  programId,
  param,
  currency,
}: {
  programId: string;
  param: string;
  currency: string;
}) {
  const [kind, setKind] = useState<Kind>("partners");
  const [csv, setCsv] = useState("");
  const [cents, setCents] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const { pending, run } = useAction();
  const file = useRef<HTMLInputElement>(null);
  // bumped on every type switch or new file: a file read that finishes after one is dropped
  const load = useRef(0);
  const readFile = async (f: File | undefined) => {
    const n = ++load.current;
    const text = (await f?.text()) ?? "";
    if (n === load.current) setCsv(text);
  };
  const centsId = useId();
  const k = KINDS.find((x) => x.kind === kind)!;
  // a file picked before the page finished loading fired its change event before React was listening
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on mount; readFile only reads refs and setState
  useEffect(() => {
    const f = file.current?.files?.[0];
    if (f) readFile(f);
  }, []);
  const pick = (next: Kind) => {
    if (next === kind) return;
    // a file picked for one type must never be imported as another
    load.current++;
    setKind(next);
    setCsv("");
    setCents(false);
    setResult(null);
    if (file.current) file.current.value = "";
  };
  return (
    <SettingsCard
      title="Import from another tool"
      description="Moving from Rewardful, FirstPromoter, Tolt or PartnerStack? Export each file as CSV from your old tool and drop it here. Import partners first. Referred customers and balances come after."
      footer={
        <Button
          variant="primary"
          loading={pending}
          disabled={!csv.trim()}
          onClick={() =>
            run(
              () => importAction(programId, kind, csv, { cents }),
              (d) => k.done(d?.created ?? 0),
              (d) => setResult(d ?? null),
            )
          }
        >
          <Upload /> Import
        </Button>
      }
    >
      <div
        role="group"
        aria-label="What is in this file"
        className="flex w-fit flex-wrap rounded-lg bg-surface-2 p-0.5 ring-1 ring-border ring-inset"
      >
        {KINDS.map((x) => (
          <button
            key={x.kind}
            type="button"
            aria-pressed={kind === x.kind}
            onClick={() => pick(x.kind)}
            className={cn(
              "flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors",
              kind === x.kind ? "bg-surface text-fg dark:bg-surface-3" : "text-subtle hover:text-fg",
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className="text-[13px] text-muted">{k.about(currency)}</p>
      <input
        ref={file}
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        className="text-[13px] text-muted file:mr-3 file:h-8 file:rounded-sm file:border file:border-border-strong file:bg-surface file:px-3 file:text-[13px] file:font-medium file:text-fg"
        onChange={async (e) => {
          setResult(null);
          await readFile(e.target.files?.[0]);
        }}
      />
      <Textarea
        value={csv}
        onChange={(e) => {
          setResult(null);
          setCsv(e.target.value);
        }}
        placeholder={k.sample}
        aria-label="CSV contents"
        className="h-40 font-mono text-[12px]"
      />
      {kind === "balances" ? (
        <label htmlFor={centsId} className="flex items-center gap-2 text-[13px] text-fg">
          <Checkbox id={centsId} checked={cents} onCheckedChange={(v) => setCents(v === true)} />
          Amounts in this file are in cents (4900 means 49.00)
        </label>
      ) : null}
      <p className="text-xs text-muted">{k.columns(param)}</p>
      {result ? (
        <div
          role="status"
          className={cn(
            "rounded-sm px-3 py-2 text-[13px]",
            result.created > 0 ? "bg-success-soft text-success" : "bg-warning-soft text-fg",
          )}
        >
          <p>
            Imported {result.created} and skipped {result.skipped}.
            {result.columns.length ? ` Columns used: ${result.columns.join(", ")}.` : ""}
          </p>
          {result.notes.length ? (
            <ul className="mt-1 list-disc pl-4">
              {result.notes.slice(0, 10).map((n, i) => (
                <li key={`${i}-${n}`}>{n}</li>
              ))}
              {result.notes.length > 10 ? (
                <li>{result.notes.length - 10} more skipped rows are not shown.</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SettingsCard>
  );
}
