import type { CommissionDuration, CommissionType, PagePlan } from "@openpromoter/db";
import { formatMoney } from "./money";

/** The parts of a program that decide what a partner earns from one customer. */
type Terms = {
  commissionType: CommissionType;
  commissionValue: number;
  commissionDuration: CommissionDuration;
  commissionMonths: number;
};

/**
 * How many payments of a plan fall inside the commission term. A lifetime term shows the first year,
 * since a calculator can't sum forever.
 */
export function paymentsInTerm(p: Terms, interval: PagePlan["interval"]): number {
  if (interval === "once" || p.commissionDuration === "once") return 1;
  const months = p.commissionDuration === "lifetime" ? 12 : p.commissionMonths;
  return interval === "month" ? months : Math.max(1, Math.ceil(months / 12));
}

/** What one customer on this plan pays during the term, and what the partner earns from them. */
export function perCustomer(p: Terms, plan: Pick<PagePlan, "amount" | "interval">) {
  const payments = paymentsInTerm(p, plan.interval);
  const perPayment = Math.round((plan.amount * p.commissionValue) / 10_000);
  return {
    revenue: plan.amount * payments,
    // a fixed commission is paid once per customer
    earned: p.commissionType === "percent" ? perPayment * payments : p.commissionValue,
    payments,
  };
}

/** The period the calculator totals cover, written to follow "You earn this". */
export const calcSpan = (p: Pick<Terms, "commissionDuration" | "commissionMonths">) =>
  p.commissionDuration === "once"
    ? "on their first payment"
    : p.commissionDuration === "lifetime"
      ? "in their first year"
      : `over their first ${p.commissionMonths} months`;

/** "$29.99 once", "$4.99 a month", "$40.00 a year". */
export const planPrice = (plan: Pick<PagePlan, "amount" | "interval">, currency: string) =>
  `${formatMoney(plan.amount, currency)} ${plan.interval === "once" ? "once" : `a ${plan.interval}`}`;
