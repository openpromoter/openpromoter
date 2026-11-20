"use client";

import { Input } from "@openpromoter/ui";
import { type CSSProperties, useState } from "react";
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
// a typed count can go past the slider's end
const TYPED_MAX = 9999;

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
          const set = (v: string) =>
            setCounts((c) => ({
              ...c,
              [r.id]: Math.min(TYPED_MAX, Math.max(0, Math.floor(Number(v) || 0))),
            }));
          return (
            <div key={r.id}>
              <div className="flex items-center justify-between gap-3 text-[14px]">
                <label htmlFor={`calc-${r.id}`} className="min-w-0 text-fg">
                  {r.label}
                  <span className="block text-[13px] leading-5 text-muted">{r.price}</span>
                </label>
                <span className="flex shrink-0 items-center gap-2 text-muted">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={TYPED_MAX}
                    value={n}
                    onChange={(e) => set(e.target.value)}
                    aria-label={`${r.label} customers`}
                    className="num w-16 text-right"
                  />
                  {n === 1 ? "customer" : "customers"}
                </span>
              </div>
              <input
                id={`calc-${r.id}`}
                type="range"
                min={0}
                max={MAX}
                step={1}
                value={Math.min(n, MAX)}
                onChange={(e) => set(e.target.value)}
                style={{ "--fill": `${(Math.min(n, MAX) / MAX) * 100}%` } as CSSProperties}
                className="calc-range mt-2"
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
