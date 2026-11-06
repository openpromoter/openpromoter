"use client";

import { Badge, cn } from "@openpromoter/ui";
import { ChartColumn as ChartBar, ChartLine, DotMatrix, TrendDown, TrendUp } from "@openpromoter/ui/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney, formatNumber } from "@/lib/money";

type Point = Record<string, string | number>;
type Kind = "money" | "number";
type View = "dots" | "bars" | "line";

function fmt(v: number, kind: Kind, currency: string, compact = true) {
  return kind === "money" ? formatMoney(v, currency, { compact }) : formatNumber(v, compact);
}

const dayLabel = (d: string) =>
  d.length === 10
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : d;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Round a max up to a "nice" axis top (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ), so tall bars fill the plot. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * p >= v) ?? 10) * p;
}

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(p1[1] + (p2[1] - p0[1]) / 6, 1e9)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const VIEWS: { v: View; label: string; icon: typeof DotMatrix }[] = [
  { v: "dots", label: "Dots", icon: DotMatrix },
  { v: "bars", label: "Bars", icon: ChartBar },
  { v: "line", label: "Line", icon: ChartLine },
];

type Series = {
  key: string;
  name: string;
  color?: string;
  kind?: Kind;
  /** Period total, shown once in the chart header for the selected metric. */
  total?: string;
  /** Change against the previous period as a ratio (0.12 = 12% up). */
  delta?: number;
};

/**
 * The product's chart: one series at a time on one honest y-axis. Three views of it, remembered per
 * browser: dot-matrix (the signature), solid bars and a smooth line. Several series become a switcher.
 * Give each a `total` (and `delta`) and the switcher becomes a segmented control of plain labels, with
 * the selected metric's total and change shown once below it (the Stripe chart header). The stat cards
 * above already show every total, so the tabs do not repeat them.
 * `compare` is the previous period, same keys and length, drawn as a faint dashed line and shown in the
 * tooltip. Hover shows the selected metric for that day as statement lines.
 */
export function DotChart({
  data,
  x,
  series,
  kind = "number",
  currency = "usd",
  height = 240,
  label,
  defaultView = "dots",
  compare,
  compareLabel = "Previous period",
}: {
  data: Point[];
  x: string;
  series: Series[];
  kind?: Kind;
  currency?: string;
  height?: number;
  label: string;
  defaultView?: View;
  compare?: Point[];
  compareLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<View>(defaultView);
  useEffect(() => {
    try {
      const v = localStorage.getItem("op:chart-view") as View | null;
      if (v && VIEWS.some((o) => o.v === v)) setView(v);
    } catch {}
  }, []);
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("op:chart-view", v);
    } catch {}
  };

  const s = series[active] ?? series[0]!;
  const sKind = s.kind ?? kind;
  const color = s.color ?? "var(--chart-1)";
  const values = data.map((d) => Number(d[s.key]) || 0);
  const prev = compare?.length ? data.map((_, i) => Number(compare[i]?.[s.key]) || 0) : null;
  const peak = Math.max(...values, ...(prev ?? []), 0);
  const top = niceMax(peak);
  const axisW = 48;
  const plotW = Math.max(0, width - axisW);
  const cols = data.length || 1;
  const colStep = plotW / cols;
  const pitch = 7;
  const sub = Math.max(1, Math.floor((colStep - 2) / pitch));
  const r = 2.3;
  const rows = Math.max(4, Math.floor((height - 24) / pitch));
  const plotH = rows * pitch;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = useMemo(() => {
    const n = Math.min(5, cols);
    return Array.from({ length: n }, (_, i) => Math.round((i * (cols - 1)) / Math.max(1, n - 1)));
  }, [cols]);
  const h = hover == null ? null : data[hover];
  const ptsOf = (vs: number[]): [number, number][] =>
    vs.map((v, i) => [i * colStep + colStep / 2, plotH - (v / top) * plotH]);
  const pts = ptsOf(values);
  const metricTabs = series.length > 1 && series.every((o) => o.total != null);
  const tabId = (i: number) => `chart-tab-${series[i]?.key}`;

  const viewToggle = (
    <div
      role="radiogroup"
      aria-label="Chart style"
      className="flex shrink-0 rounded-md bg-surface-2 p-0.5 ring-1 ring-border ring-inset"
    >
      {VIEWS.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={view === o.v}
          aria-label={o.label}
          title={o.label}
          onClick={() => pick(o.v)}
          className={cn(
            "flex size-6 items-center justify-center rounded-[4px]",
            view === o.v ? "bg-surface text-fg dark:bg-surface-3" : "text-subtle hover:text-fg",
          )}
        >
          <o.icon size={14} weight={view === o.v ? "fill" : "regular"} />
        </button>
      ))}
    </div>
  );
  const legend = prev ? (
    <span className="flex items-center gap-1.5 text-xs text-subtle">
      <span aria-hidden className="w-3 border-t border-dashed border-[var(--text-subtle)]" />
      {compareLabel}
    </span>
  ) : null;

  return (
    <div className="w-full">
      {metricTabs ? (
        <div className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="radiogroup"
              aria-label="Metric"
              className="flex max-w-full overflow-x-auto rounded-lg bg-surface-2 p-0.5 ring-1 ring-border ring-inset"
            >
              {series.map((o, i) => (
                <button
                  key={o.key}
                  id={tabId(i)}
                  type="button"
                  role="radio"
                  aria-checked={i === active}
                  onClick={() => setActive(i)}
                  className={cn(
                    "h-7 shrink-0 rounded-md px-3 text-xs font-medium",
                    i === active ? "bg-surface text-fg dark:bg-surface-3" : "text-subtle hover:text-fg",
                  )}
                >
                  {o.name}
                </button>
              ))}
            </div>
            {viewToggle}
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="figure text-[24px] leading-8 text-fg">{s.total}</span>
              {s.delta != null ? (
                <span className="flex items-center gap-2 text-xs text-subtle">
                  <Badge tone={s.delta >= 0 ? "success" : "danger"} className="num gap-1">
                    {s.delta >= 0 ? <TrendUp size={13} aria-hidden /> : <TrendDown size={13} aria-hidden />}
                    {Math.abs(s.delta * 100).toFixed(1)}%
                  </Badge>
                  vs {compareLabel.charAt(0).toLowerCase() + compareLabel.slice(1)}
                </span>
              ) : null}
            </div>
            {legend}
          </div>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {series.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Series">
              {series.map((o, i) => (
                <button
                  key={o.key}
                  id={tabId(i)}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  onClick={() => setActive(i)}
                  className={cn(
                    "inline-flex h-7 items-center gap-2 rounded-[5px] border px-2.5 text-xs font-medium",
                    i === active
                      ? "border-border-strong bg-surface text-fg"
                      : "border-transparent text-subtle hover:text-fg",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-[2px]"
                    style={{ background: i === active ? (o.color ?? "var(--chart-1)") : "var(--dot)" }}
                  />
                  {o.name}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {legend}
            {viewToggle}
          </div>
        </div>
      )}
      <div
        ref={ref}
        role="img"
        aria-label={`${label}. Showing ${s.name}.`}
        className="relative w-full"
        style={{ height: plotH + 24 }}
      >
        {width > 0 ? (
          <svg width={width} height={plotH + 24} className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                {view !== "dots" ? (
                  <line
                    x1={axisW}
                    x2={width}
                    y1={plotH - t * plotH}
                    y2={plotH - t * plotH}
                    stroke="var(--border)"
                    strokeDasharray={t === 0 ? undefined : "2 3"}
                  />
                ) : null}
                <text
                  x={0}
                  y={plotH - t * plotH + 4}
                  className="fill-[var(--text-subtle)] text-[11px] tabular-nums"
                >
                  {/* nothing to plot yet: one "$0" on the baseline, not five of them */}
                  {peak > 0 || t === 0 ? fmt(top * t, sKind, currency) : null}
                </text>
              </g>
            ))}
            <g transform={`translate(${axisW},0)`}>
              {view === "line" ? (
                <g>
                  <path
                    d={`${smooth(pts)} L${pts.at(-1)?.[0] ?? 0},${plotH} L${pts[0]?.[0] ?? 0},${plotH} Z`}
                    fill={color}
                    opacity={0.08}
                  />
                  {hover != null && pts[hover] ? (
                    <line
                      x1={pts[hover]![0]}
                      x2={pts[hover]![0]}
                      y1={0}
                      y2={plotH}
                      stroke="var(--border-strong)"
                    />
                  ) : null}
                  <path d={smooth(pts)} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
                  {hover != null && pts[hover] ? (
                    <circle
                      cx={pts[hover]![0]}
                      cy={pts[hover]![1]}
                      r={4}
                      fill="var(--surface)"
                      stroke={color}
                      strokeWidth={2}
                    />
                  ) : null}
                </g>
              ) : null}
              {data.map((d, i) => {
                const dim = hover == null || hover === i ? 1 : 0.4;
                const v = values[i] ?? 0;
                if (view === "bars") {
                  const bw = Math.max(2, Math.min(colStep * 0.64, 22));
                  const bh = Math.max(v > 0 ? 2 : 0, (v / top) * plotH);
                  return (
                    <rect
                      key={String(d[x])}
                      opacity={dim}
                      x={i * colStep + (colStep - bw) / 2}
                      y={plotH - bh}
                      width={bw}
                      height={bh}
                      rx={Math.min(3, bw / 3)}
                      fill={color}
                    />
                  );
                }
                if (view === "dots") {
                  const filled = Math.round((v / top) * rows);
                  const x0 = i * colStep + (colStep - (sub - 1) * pitch) / 2;
                  return (
                    <g key={String(d[x])} opacity={dim}>
                      {Array.from({ length: sub }, (_, k) =>
                        Array.from({ length: rows }, (_, j) => (
                          <circle
                            key={`${k}-${j}`}
                            cx={x0 + k * pitch}
                            cy={plotH - j * pitch - pitch / 2}
                            r={r}
                            fill={j < filled ? color : "var(--dot)"}
                          />
                        )),
                      )}
                    </g>
                  );
                }
                return null;
              })}
              {prev ? (
                <path
                  d={smooth(ptsOf(prev))}
                  fill="none"
                  stroke="var(--text-subtle)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                  opacity={0.7}
                />
              ) : null}
              {data.map((d, i) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover-only tooltip; the chart has an aria-label summary
                <rect
                  key={`h${String(d[x])}`}
                  x={i * colStep}
                  y={0}
                  width={colStep}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
              {xTicks.map((i) => (
                <text
                  key={i}
                  x={i * colStep + colStep / 2}
                  y={plotH + 18}
                  textAnchor={i === 0 ? "start" : i === cols - 1 ? "end" : "middle"}
                  className="fill-[var(--text-subtle)] text-[11px]"
                >
                  {dayLabel(String(data[i]?.[x] ?? ""))}
                </text>
              ))}
            </g>
          </svg>
        ) : null}
        {h && hover != null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-48 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
            style={{ left: Math.min(Math.max(axisW + hover * colStep - 90, 0), Math.max(0, width - 200)) }}
          >
            <div className="mb-1.5 font-medium text-fg">{s.name}</div>
            <div className="flex items-center">
              <span aria-hidden className="mr-1.5 size-1.5 rounded-[2px]" style={{ background: color }} />
              <span className="text-muted">{dayLabel(String(h[x]))}</span>
              <span className="leader" />
              <span className="num font-medium text-fg">
                {fmt(values[hover] ?? 0, sKind, currency, false)}
              </span>
            </div>
            {prev ? (
              <div className="flex items-center">
                <span
                  aria-hidden
                  className="mr-1.5 w-1.5 border-t border-dashed border-[var(--text-subtle)]"
                />
                <span className="text-muted">{dayLabel(String(compare?.[hover]?.[x] ?? compareLabel))}</span>
                <span className="leader" />
                <span className="num text-muted">{fmt(prev[hover] ?? 0, sKind, currency, false)}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Tiny sparklines for KPI cards, drawn with HTML so dots stay round at any width.
 * The last `recent` columns take the colour; earlier ones stay grey, like a statement's current period.
 * Both scale from the period's low so a steady series still shows its shape.
 */
function sparkLevels(values: number[], steps: number) {
  const max = Math.max(...values, 0) || 1; // not max(…, 1): ratios like conversion live below 1
  const min = Math.min(...values, max) * 0.6;
  return values.map((v) => Math.max(v > 0 ? 1 : 0, Math.round(((v - min) / (max - min || 1)) * steps)));
}

export function DotSpark({
  values,
  color = "var(--chart-1)",
  rows = 6,
  recent = values.length,
  className,
}: {
  values: number[];
  color?: string;
  rows?: number;
  recent?: number;
  className?: string;
}) {
  const levels = sparkLevels(values, rows);
  return (
    <div className={cn("flex items-end justify-between", className)} aria-hidden>
      {levels.map((filled, i) => (
        <span key={i} className="flex flex-col-reverse gap-[2px]">
          {Array.from({ length: rows }, (_, j) => (
            <span
              key={j}
              className="size-[3px] rounded-full"
              style={{
                background:
                  j >= filled ? "var(--dot)" : i >= values.length - recent ? color : "var(--border-strong)",
              }}
            />
          ))}
        </span>
      ))}
    </div>
  );
}

export function BarSpark({
  values,
  color = "var(--chart-1)",
  recent = values.length,
  className,
}: {
  values: number[];
  color?: string;
  recent?: number;
  className?: string;
}) {
  const levels = sparkLevels(values, 100);
  return (
    <div className={cn("flex h-8 items-end justify-between", className)} aria-hidden>
      {levels.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-[1px]"
          style={{
            height: `${Math.max(8, h)}%`,
            background: i >= values.length - recent ? color : "var(--border-strong)",
          }}
        />
      ))}
    </div>
  );
}

/** Horizontal ledger bars: label, dotted track filled to the value, amount. */
export function BarChart({
  data,
  x,
  y,
  kind = "number",
  currency = "usd",
  label,
}: {
  data: Point[];
  x: string;
  y: string;
  name: string;
  kind?: Kind;
  currency?: string;
  height?: number;
  label: string;
}) {
  const max = Math.max(...data.map((d) => Number(d[y]) || 0), 1);
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {data.map((d) => {
        const v = Number(d[y]) || 0;
        return (
          <li
            key={String(d[x])}
            className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-[13px]"
          >
            <span className="truncate text-muted">{String(d[x])}</span>
            <span className="relative h-2.5">
              <span
                aria-hidden
                className="absolute inset-0 bg-[radial-gradient(circle,var(--dot)_1.6px,transparent_1.8px)] bg-[length:6px_10px] bg-repeat-x"
              />
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-[radial-gradient(circle,var(--chart-1)_1.6px,transparent_1.8px)] bg-[length:6px_10px] bg-repeat-x"
                style={{ width: `${Math.max(2, (v / max) * 100)}%` }}
              />
            </span>
            <span className="num w-20 text-right font-medium text-fg">{fmt(v, kind, currency)}</span>
          </li>
        );
      })}
    </ul>
  );
}
