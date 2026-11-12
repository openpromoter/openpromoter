"use client";

import { Badge, Button, Field, Input, Select, Textarea } from "@openpromoter/ui";
import { useState } from "react";
import { CountrySelect } from "@/components/country-select";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import { taxFormAction } from "../../portal-actions";

export function TaxForm({
  slug,
  form,
  status,
  legalName,
  address,
  country,
  vatId,
  hasTin,
  viaStripe,
}: {
  slug: string;
  form: string;
  status: string;
  legalName: string;
  address: string;
  country: string;
  vatId: string;
  hasTin: boolean;
  viaStripe: boolean;
}) {
  const [f, setF] = useState(form);
  const { pending, run } = useAction();
  return (
    <SettingsCard
      title="Tax information"
      description="US persons fill in a W-9; everyone else a W-8BEN (individuals) or W-8BEN-E (companies). EU businesses add a VAT ID so invoices use the reverse charge."
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/60 px-4 py-3 dark:bg-surface-2">
        <span className="text-[13px] text-muted">Status</span>
        {status !== "missing" ? (
          <Badge tone="success" dot className="capitalize">
            {status}
          </Badge>
        ) : (
          <Badge tone="warning" dot>
            Missing
          </Badge>
        )}
      </div>
      {viaStripe ? (
        <p className="text-[13px] leading-5 text-muted">
          Your Stripe payout account also collects tax details. Fill this in too if you're paid by PayPal,
          Wise or bank transfer.
        </p>
      ) : null}
      <form
        className="flex flex-col gap-4"
        // onSubmit, not action: React resets a form after its action, which would wipe it on an error
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          run(
            () => taxFormAction(slug, Object.fromEntries([...d.entries()].map(([k, v]) => [k, String(v)]))),
            "Saved",
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Form" htmlFor="tx-form">
            <Select id="tx-form" name="form" value={f} onValueChange={(v) => setF(v)}>
              <option value="w9">W-9 (US person)</option>
              <option value="w8ben">W-8BEN (non-US individual)</option>
              <option value="w8bene">W-8BEN-E (non-US company)</option>
            </Select>
          </Field>
          <Field label="Country" htmlFor="tx-cc">
            <CountrySelect id="tx-cc" defaultValue={country} required />
          </Field>
        </div>
        <Field label="Legal name" htmlFor="tx-name">
          <Input id="tx-name" name="legalName" defaultValue={legalName} required />
        </Field>
        <Field label="Address" htmlFor="tx-addr">
          <Textarea id="tx-addr" name="address" defaultValue={address} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={f === "w9" ? "SSN or EIN" : "Foreign tax ID (optional)"}
            htmlFor="tx-tin"
            hint={
              hasTin
                ? "On file (encrypted). Enter again to replace."
                : "Stored encrypted. Only used for tax reporting."
            }
          >
            <Input
              id="tx-tin"
              name="tin"
              autoComplete="off"
              required={f === "w9" && !hasTin}
              className="font-mono placeholder:font-sans"
            />
          </Field>
          <Field label="EU VAT ID (optional)" htmlFor="tx-vat">
            <Input
              id="tx-vat"
              name="vatId"
              defaultValue={vatId}
              className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
            />
          </Field>
        </div>
        <label className="flex items-start gap-3 border-t border-border pt-4 text-[13px] leading-5 text-muted">
          <input
            type="checkbox"
            name="certify"
            required
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span>
            Under penalties of perjury, I certify that the information above is correct. I also certify that I
            am the beneficial owner (or authorized to sign for the beneficial owner) of the income.
          </span>
        </label>
        <Button type="submit" variant="primary" loading={pending} className="self-start">
          Save tax details
        </Button>
      </form>
    </SettingsCard>
  );
}
