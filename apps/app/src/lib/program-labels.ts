import type { program } from "@openpromoter/db";
import { formatMoney } from "./money";

type P = Pick<
  typeof program.$inferSelect,
  "commissionType" | "commissionValue" | "currency" | "commissionDuration" | "commissionMonths"
>;

export const rateLabel = (p: P) =>
  p.commissionType === "percent" ? `${p.commissionValue / 100}%` : formatMoney(p.commissionValue, p.currency);

export const durationLabel = (p: P) =>
  p.commissionDuration === "lifetime"
    ? "for the lifetime of every customer"
    : p.commissionDuration === "months"
      ? `for ${p.commissionMonths} months per customer`
      : "on each customer's first payment";
