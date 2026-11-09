import type { program } from "@openpromoter/db";
import { formatMoney } from "./money";

type P = Pick<
  typeof program.$inferSelect,
  "commissionType" | "commissionValue" | "currency" | "commissionDuration" | "commissionMonths"
> & { commissionAfterValue?: number | null };

export const rateLabel = (p: P, value = p.commissionValue) =>
  p.commissionType === "percent" ? `${value / 100}%` : formatMoney(value, p.currency);

/** ", then 10% for life" when the program keeps paying a lower rate after its first months. */
export const afterLabel = (p: P) =>
  p.commissionDuration === "months" && p.commissionAfterValue
    ? `, then ${rateLabel(p, p.commissionAfterValue)} for life`
    : "";

export const durationLabel = (p: P) =>
  p.commissionDuration === "lifetime"
    ? "for the lifetime of every customer"
    : p.commissionDuration === "months"
      ? `for ${p.commissionMonths} months per customer${afterLabel(p)}`
      : "on each customer's first payment";

/** "Pro, $49.00/month" for a synced billing price. */
export const priceLabel = (x: {
  productName: string;
  unitAmount: number | null;
  currency: string;
  interval: string | null;
}) =>
  x.unitAmount == null
    ? x.productName
    : `${x.productName}, ${formatMoney(x.unitAmount, x.currency)}${x.interval ? `/${x.interval}` : ""}`;
