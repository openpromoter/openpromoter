import type { partner, payout, program } from "@openpromoter/db";
import { formatMoney } from "./money";

const EU = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

/** Self-billed commission invoice. Shows the EU reverse-charge note when the partner has an EU VAT ID. */
export function Invoice({
  po,
  pt,
  prog,
  workspaceName,
}: {
  po: typeof payout.$inferSelect;
  pt: typeof partner.$inferSelect;
  prog: typeof program.$inferSelect;
  workspaceName: string;
}) {
  const reverseCharge = !!pt.vatId && EU.has((pt.country ?? pt.vatId.slice(0, 2)).toUpperCase());
  return (
    <article className="mx-auto max-w-[720px] rounded-md border border-border bg-white p-10 text-[13px] text-[#15191A] print:border-0 print:p-0">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Commission invoice</h1>
          <p className="text-[#5A6164]">Self-billed on behalf of the partner</p>
        </div>
        <div className="text-right">
          <div className="font-mono">{po.invoiceNumber ?? po.id}</div>
          <div className="text-[#5A6164]">
            {(po.paidAt ?? po.createdAt).toLocaleDateString("en-US", { dateStyle: "long" })}
          </div>
        </div>
      </header>
      <div className="mt-8 grid grid-cols-2 gap-8">
        <div>
          <div className="text-xs font-semibold text-[#5A6164]">From (supplier)</div>
          <div className="mt-1 font-medium">{pt.taxLegalName ?? pt.name}</div>
          <div className="whitespace-pre-line">{pt.taxAddress ?? pt.email}</div>
          {pt.vatId ? <div className="mt-1">VAT ID: {pt.vatId}</div> : null}
        </div>
        <div>
          <div className="text-xs font-semibold text-[#5A6164]">To (customer)</div>
          <div className="mt-1 font-medium">{workspaceName}</div>
          <div>{prog.websiteUrl}</div>
        </div>
      </div>
      <table className="mt-8 w-full">
        <thead>
          <tr className="border-b border-[#E3E5E1] text-left text-xs text-[#5A6164]">
            <th className="py-2 font-medium">Description</th>
            <th className="py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[#E3E5E1]">
            <td className="py-3">
              Affiliate marketing services for {prog.name}
              {po.periodStart
                ? ` (${po.periodStart.toLocaleDateString()} – ${po.periodEnd?.toLocaleDateString()})`
                : ""}
            </td>
            <td className="num py-3 text-right">{formatMoney(po.amount, po.currency)}</td>
          </tr>
          <tr>
            <td className="py-3 text-right font-semibold">Total</td>
            <td className="num py-3 text-right font-semibold">{formatMoney(po.amount, po.currency)}</td>
          </tr>
        </tbody>
      </table>
      {reverseCharge ? (
        <p className="mt-6 rounded-sm bg-[#F3F4F2] p-3">
          Reverse charge: VAT to be accounted for by the recipient (Article 196, Council Directive
          2006/112/EC).
        </p>
      ) : null}
      <p className="mt-6 text-xs text-[#5A6164]">
        Paid via {po.method}
        {po.externalId ? ` (reference ${po.externalId})` : ""}. Issued under a self-billing agreement accepted
        by the partner in the program terms.
      </p>
    </article>
  );
}
