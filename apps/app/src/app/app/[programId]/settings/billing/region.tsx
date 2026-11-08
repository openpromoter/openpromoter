"use client";

import { Card, Field, Select } from "@openpromoter/ui";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/use-action";
import { billingRegionAction } from "./actions";

/** Where the business is billed decides India GST on the plan, so it is asked before the first Choose. */
export function BillingRegion({ programId, region }: { programId: string; region: string | null }) {
  const { run } = useAction();
  const router = useRouter();
  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-[460px]">
        <div className="text-[13px] font-medium text-fg">Where is your business billed?</div>
        <p className="mt-1 text-xs text-muted">
          Indian businesses pay 18% GST on top of the price: CGST and SGST in Uttar Pradesh, IGST in other
          states. Businesses outside India pay no GST.
        </p>
      </div>
      <Field label="Billing location" htmlFor="bl-region" className="sm:w-64">
        <Select
          id="bl-region"
          value={region ?? ""}
          onValueChange={(v) =>
            run(
              () => billingRegionAction(programId, v),
              "Saved",
              () => router.refresh(),
            )
          }
        >
          <option value="" disabled>
            Choose one
          </option>
          <option value="abroad">Outside India</option>
          <option value="in_home">India: Uttar Pradesh</option>
          <option value="in_other">India: another state</option>
        </Select>
      </Field>
    </Card>
  );
}
