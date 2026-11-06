"use client";

import { Button, Textarea } from "@openpromoter/ui";
import { Upload } from "@openpromoter/ui/icons";
import { useEffect, useRef, useState } from "react";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import { importPartnersAction } from "../../settings-actions";

export function ImportForm({ programId, param }: { programId: string; param: string }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<{ created: number; skipped: number; columns: string[] } | null>(null);
  const { pending, run } = useAction();
  const file = useRef<HTMLInputElement>(null);
  // a file picked before the page finished loading fired its change event before React was listening
  useEffect(() => {
    const f = file.current?.files?.[0];
    if (f) f.text().then(setCsv);
  }, []);
  return (
    <SettingsCard
      title="Import partners"
      description="Moving from Rewardful, FirstPromoter, Tolt or PartnerStack? Export your affiliates as CSV and drop the file here. Partners keep their referral codes, and links already shared keep working because op.js still reads ?via=, ?fpr=, ?ref= and ?gspk=."
      footer={
        <Button
          variant="primary"
          loading={pending}
          disabled={!csv}
          onClick={() =>
            run(
              () => importPartnersAction(programId, csv),
              (d) => `${d?.created ?? 0} partners imported`,
              (d) => setResult(d ?? null),
            )
          }
        >
          <Upload /> Import
        </Button>
      }
    >
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
        placeholder={
          "email,name,referral_code,coupon_code,paypal_email\nmaya@example.com,Maya Chen,maya,MAYA20,maya@example.com"
        }
        aria-label="CSV contents"
        className="h-40 font-mono text-[12px]"
      />
      <p className="text-xs text-muted">
        Recognized columns: email, name (or first/last name), referral code (code, ref_id, token, via, gspk…),
        coupon, paypal email, website and country. Your program link parameter is ?{param}=.
      </p>
      {result ? (
        <p className="rounded-sm bg-success-soft px-3 py-2 text-[13px] text-success">
          Imported {result.created} and skipped {result.skipped} (duplicates or missing email). Columns used:{" "}
          {result.columns.join(", ")}.
        </p>
      ) : null}
    </SettingsCard>
  );
}
