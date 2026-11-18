"use client";
import { Button, cn, Textarea } from "@openpromoter/ui";
import { Upload } from "@openpromoter/ui/icons";
import { useEffect, useRef, useState } from "react";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import { importAction } from "../../settings-actions";

type Kind = "partners" | "referrals" | "balances";
type Result = {
  created: number;
  skipped: number;
  columns: string[];
  conflicts?: string[];
  missing?: string[];
};

const KINDS: { kind: Kind; label: string; sample: string; done: (n: number) => string }[] = [
  {
    kind: "partners",
    label: "Partners",
    sample:
      "email,name,referral_code,coupon_code,paypal_email\nmaya@example.com,Maya Chen,maya,MAYA20,maya@example.com",
    done: (n) => `${n} partners imported`,
  },
  {
    kind: "referrals",
    label: "Referred customers",
    sample:
      "partner_email,stripe_customer_id,customer_email,status\nmaya@example.com,cus_Q1w2E3,lee@example.com,active",
    done: (n) => `${n} customers imported`,
  },
  {
    kind: "balances",
    label: "Balances",
    sample: "partner_email,unpaid,total_paid\nmaya@example.com,120.00,900.00",
    done: (n) => `${n} balances imported`,
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
  const [result, setResult] = useState<Result | null>(null);
  const { pending, run } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const k = KINDS.find((x) => x.kind === kind)!;
  // a file picked before the page finished loading fired its change event before React was listening
  useEffect(() => {
    const f = file.current?.files?.[0];
    if (f) f.text().then(setCsv);
  }, []);
  const notes = [...(result?.conflicts ?? []), ...(result?.missing ?? [])];
  return (
    <SettingsCard
      title="Import from another tool"
      description="Moving from Rewardful, FirstPromoter, Tolt or PartnerStack? Export each file as CSV from your old tool and drop it here. Import partners first, then referred customers, then balances."
      footer={
        <Button
          variant="primary"
          loading={pending}
          disabled={!csv}
          onClick={() =>
            run(
              () => importAction(programId, kind, csv),
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
        className="flex w-fit rounded-lg bg-surface-2 p-0.5 ring-1 ring-border ring-inset"
      >
        {KINDS.map((x) => (
          <button
            key={x.kind}
            type="button"
            aria-pressed={kind === x.kind}
            onClick={() => {
              setKind(x.kind);
              setResult(null);
            }}
            className={cn(
              "flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors",
              kind === x.kind ? "bg-surface text-fg dark:bg-surface-3" : "text-subtle hover:text-fg",
            )}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className="text-[13px] text-muted">
        {kind === "partners"
          ? `Partners keep their referral codes, and links already shared keep working because op.js still reads ?via=, ?fpr=, ?ref= and ?gspk=.`
          : kind === "referrals"
            ? "Each row needs the partner's email or code and the customer's billing ID or email. Renewals from these customers keep paying the same partner."
            : `Each row needs the partner's email or code and their unpaid and paid amounts in ${currency.toUpperCase()}. Unpaid amounts go into the next payout. Paid amounts count toward the partner's lifetime total.`}
      </p>
      <input
        ref={file}
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        className="text-[13px] text-muted file:mr-3 file:h-8 file:rounded-sm file:border file:border-border-strong file:bg-surface file:px-3 file:text-[13px] file:font-medium file:text-fg"
        onChange={async (e) => setCsv((await e.target.files?.[0]?.text()) ?? "")}
      />
      <Textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={k.sample}
        aria-label="CSV contents"
        className="h-40 font-mono text-[12px]"
      />
      <p className="text-xs text-muted">
        {kind === "partners"
          ? `Recognized columns: email, name (or first/last name), referral code (code, ref_id, token, via, gspk…), coupon, paypal email, website and country. Your program link parameter is ?${param}=.`
          : kind === "referrals"
            ? "Recognized columns: partner email or referral code, customer ID (stripe_customer_id, customer_id, uid…), customer email, name, status and converted date."
            : "Recognized columns: partner email or referral code, unpaid (balance, amount_due…) and paid (total_paid, paid_out…)."}
      </p>
      {result ? (
        <div className="rounded-sm bg-success-soft px-3 py-2 text-[13px] text-success">
          <p>
            Imported {result.created} and skipped {result.skipped}. Columns used: {result.columns.join(", ")}.
          </p>
          {notes.length ? (
            <ul className="mt-1 list-disc pl-4">
              {notes.slice(0, 10).map((n) => (
                <li key={n}>{n}</li>
              ))}
              {notes.length > 10 ? <li>and {notes.length - 10} more</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </SettingsCard>
  );
}
