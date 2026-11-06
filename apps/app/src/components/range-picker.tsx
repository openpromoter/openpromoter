import { cn } from "@openpromoter/ui";
import Link from "next/link";

const RANGES = [
  ["7", "7d"],
  ["30", "30d"],
  ["90", "90d"],
  ["365", "12m"],
] as const;

export function RangePicker({ days, base }: { days: number; base: string }) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-border ring-inset"
    >
      {RANGES.map(([v, l]) => (
        <Link
          key={v}
          href={`${base}?days=${v}`}
          scroll={false}
          aria-current={String(days) === v ? "true" : undefined}
          className={cn(
            "num flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors",
            String(days) === v ? "bg-surface text-fg dark:bg-surface-3" : "text-subtle hover:text-fg",
          )}
        >
          {l}
        </Link>
      ))}
    </div>
  );
}
