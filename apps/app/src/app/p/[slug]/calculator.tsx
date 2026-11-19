"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";

export type CalcRow = {
  id: string;
  label: string;
  /** "$4.99 a month" */
  price: string;
  /** Per customer, over the span: what they pay and what the partner earns. */
  revenue: number;
  earned: number;
};

const MAX = 250;

/** One slider per price: drag how many customers you send and see what they pay and what you earn. */
export function EarningsCalculator({
  rows,
  currency,
  span,
}: {
  rows: CalcRow[];
  currency: string;
  span: string;
}) {
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, 10])),
  );
  const money = (minor: number) => formatMoney(minor, currency, { whole: true });
  const revenue = rows.reduce((s, r) => s + r.revenue * (counts[r.id] ?? 0), 0);
  const earned = rows.reduce((s, r) => s + r.earned * (counts[r.id] ?? 0), 0);
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-col gap-5 px-5 py-5">
        {rows.map((r) => {
          const n = counts[r.id] ?? 0;
          return (
            <div key={r.id}>
              <div className="flex items-baseline justify-between gap-3 text-[14px]">
                <label htmlFor={`calc-${r.id}`} className="min-w-0 truncate text-fg">
                  {r.label} <span className="text-muted">· {r.price}</span>
                </label>
                <span className="num shrink-0 text-muted">
                  <span className="font-medium text-fg">{n}</span> {n === 1 ? "customer" : "customers"}
                </span>
              </div>
              <input
                id={`calc-${r.id}`}
                type="range"
                min={0}
                max={MAX}
                step={1}
                value={n}
                onChange={(e) => setCounts((c) => ({ ...c, [r.id]: Number(e.target.value) }))}
                className="mt-2 h-6 w-full cursor-pointer accent-[var(--accent)]"
              />
            </div>
          );
        })}
      </div>
      <div className="perforated" aria-hidden />
      <dl className="grid grid-cols-2 bg-surface-2/70 dark:bg-surface-2" aria-live="polite">
        <div className="min-w-0 px-5 py-4">
          <dt className="text-[13px] leading-5 text-muted">Your customers pay</dt>
          <dd className="figure mt-1 text-[20px] leading-7 text-fg sm:text-[26px] sm:leading-8">
            {money(revenue)}
          </dd>
        </div>
        <div className="min-w-0 border-l border-border px-5 py-4">
          <dt className="text-[13px] leading-5 text-muted">You earn</dt>
          <dd className="figure mt-1 text-[20px] leading-7 text-accent-text sm:text-[26px] sm:leading-8">
            {money(earned)}
          </dd>
        </div>
      </dl>
      <p className="border-t border-border px-5 py-3 text-[13px] leading-5 text-subtle">
        Totals cover each customer {span}.
      </p>
    </div>
  );
}
