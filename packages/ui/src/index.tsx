import type { VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { Loader2, type LucideIcon } from "./icons";

export * from "./base";
export * from "./client";
export * from "./mascot";

import { buttonVariants, cn, fieldClass } from "./base";
import { Beacon, type BeaconPose } from "./mascot";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

/* ------------------------------------------------------------------ Form controls */

const field = fieldClass;

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(field, "h-8", className)} {...props} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-20 py-2 leading-5", className)} {...props} />
));
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-fg", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-4 text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function InputAdornment({
  prefix,
  suffix,
  children,
}: {
  prefix?: string;
  suffix?: string;
  children: React.ReactElement;
}) {
  return (
    <div className="relative flex items-center">
      {prefix ? (
        <span className="pointer-events-none absolute left-2.5 text-[13px] text-subtle">{prefix}</span>
      ) : null}
      {children}
      {suffix ? (
        <span className="pointer-events-none absolute right-2.5 text-[13px] text-subtle">{suffix}</span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Surfaces */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-medium tracking-[-0.01em] text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function Separator({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-border", className)} />;
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("rounded-sm bg-surface-3", className)} style={style} aria-hidden />;
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border bg-surface px-1 font-sans text-[11px] font-medium text-subtle",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------ Badges */

const badgeTones = {
  neutral: "bg-neutral-soft text-neutral",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  primary: "bg-accent-soft text-accent-text",
} as const;

export type BadgeTone = keyof typeof badgeTones;

/** Small square tag (4px radius, never a pill) for labels: AI, Test, Announcement. Statuses use <StatusBadge>. */
export function Badge({
  tone = "neutral",
  icon: Icon,
  dot,
  children,
  className,
  title,
}: {
  tone?: BadgeTone;
  icon?: LucideIcon;
  /** Renders as a status badge (glyph + text on a tint) instead of a plain tag. */
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  if (dot) {
    const kind: Glyph = (
      {
        neutral: "todo",
        info: "progress",
        success: "done",
        warning: "attention",
        danger: "stopped",
        primary: "progress",
      } as const
    )[tone];
    return (
      <GlyphBadge kind={kind} title={title} className={className}>
        {children}
      </GlyphBadge>
    );
  }
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 text-[11px] leading-none font-medium",
        badgeTones[tone],
        className,
      )}
    >
      {Icon ? <Icon className="size-3" aria-hidden /> : null}
      {children}
    </span>
  );
}

type Glyph = "todo" | "progress" | "done" | "paused" | "stopped" | "attention";
const STATUS_TONE: Record<Glyph, string> = {
  todo: "text-subtle",
  progress: "text-info",
  done: "text-success",
  paused: "text-warning",
  attention: "text-warning",
  stopped: "text-danger",
};

/** Status glyphs drawn on a 14px grid, one shape per state family, so status reads without colour too. */
export function StatusGlyph({ kind, className }: { kind: Glyph; className?: string }) {
  const c = cn("size-3.5 shrink-0", STATUS_TONE[kind], className);
  switch (kind) {
    case "todo":
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle
            cx="7"
            cy="7"
            r="5.25"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="2.2 2.1"
          />
        </svg>
      );
    case "progress":
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </svg>
      );
    case "done":
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path
            d="m4.4 7.2 1.8 1.8 3.5-3.7"
            fill="none"
            stroke="var(--surface)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "paused":
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.6 5v4M8.4 5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "attention":
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M7 4.2v3.3" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="9.7" r="0.9" fill="var(--surface)" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 14 14" className={c} aria-hidden>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="m5 5 4 4M9 5 5 9" stroke="var(--surface)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

const STATUS: Record<string, { glyph: Glyph; label: string }> = {
  pending: { glyph: "todo", label: "Pending" },
  approved: { glyph: "progress", label: "Approved" },
  held: { glyph: "paused", label: "Held" },
  paid: { glyph: "done", label: "Paid" },
  reversed: { glyph: "stopped", label: "Reversed" },
  awaiting_approval: { glyph: "attention", label: "Needs approval" },
  processing: { glyph: "progress", label: "Processing" },
  failed: { glyph: "stopped", label: "Failed" },
  canceled: { glyph: "todo", label: "Canceled" },
  active: { glyph: "done", label: "Active" },
  rejected: { glyph: "stopped", label: "Rejected" },
  paused: { glyph: "paused", label: "Paused" },
  banned: { glyph: "stopped", label: "Banned" },
  lead: { glyph: "todo", label: "Lead" },
  trialing: { glyph: "progress", label: "Trial" },
  refunded: { glyph: "stopped", label: "Refunded" },
  draft: { glyph: "todo", label: "Draft" },
  ended: { glyph: "todo", label: "Ended" },
  suggested: { glyph: "progress", label: "Suggested" },
  applied: { glyph: "done", label: "Applied" },
  undone: { glyph: "todo", label: "Undone" },
  dismissed: { glyph: "todo", label: "Dismissed" },
  open: { glyph: "attention", label: "Open" },
  confirmed: { glyph: "stopped", label: "Confirmed" },
  new: { glyph: "progress", label: "New" },
  sent: { glyph: "progress", label: "Invited" },
  followed_up: { glyph: "progress", label: "Followed up" },
  joined: { glyph: "done", label: "Joined" },
  succeeded: { glyph: "done", label: "Delivered" },
};

const GLYPH_BADGE: Record<Glyph, string> = {
  todo: "bg-neutral-soft text-muted",
  progress: "bg-info-soft text-info",
  done: "bg-success-soft text-success",
  paused: "bg-warning-soft text-warning",
  attention: "bg-warning-soft text-warning",
  stopped: "bg-danger-soft text-danger",
};

/** Square tinted badge: 4px radius, never a pill, no icon. The label carries the state. */
function GlyphBadge({
  kind,
  title,
  className,
  children,
}: {
  kind: Glyph;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center rounded-[4px] px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        GLYPH_BADGE[kind],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({
  status,
  title,
  className,
}: {
  status: string;
  title?: string;
  className?: string;
}) {
  const s = STATUS[status] ?? { glyph: "todo" as const, label: status.replace(/_/g, " ") };
  return (
    <GlyphBadge kind={s.glyph} title={title} className={className}>
      {s.label}
    </GlyphBadge>
  );
}

/* ------------------------------------------------------------------ States */

export function EmptyState({
  icon: Icon,
  mascot,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  /** Shows Beacon instead of the icon. Dashboard only, never in the partner portal. */
  mascot?: BeaconPose;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {mascot ? (
        <Beacon pose={mascot} size={72} className="mb-3" />
      ) : (
        <Icon className="mb-3 size-6 text-subtle" aria-hidden />
      )}
      <h3 className="text-[15px] font-medium tracking-[-0.01em] text-fg">{title}</h3>
      {description ? <p className="mt-1 max-w-[56ch] text-[13px] text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Avatar({
  name,
  src,
  size = 28,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  // soft paper tones with dark ink, like the stickers on a ledger
  const hues = [
    ["#dfe5ff", "#1b33c9"],
    ["#d9f2e1", "#11602e"],
    ["#fde4cf", "#8a3f0c"],
    ["#f6dbe7", "#8b1d4c"],
    ["#e7defd", "#4f2aa8"],
    ["#d5eef3", "#0b5866"],
    ["#ecebe6", "#3e3f44"],
  ] as const;
  const tone = hues[hash % hues.length] ?? hues[0];
  return src ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full object-cover", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: tone[0],
        color: tone[1],
      }}
    >
      {initials || "?"}
    </span>
  );
}

export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-200"
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Tables */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

export function Th({
  className,
  align,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      className={cn(
        "sticky top-0 h-9 border-b border-border bg-surface-2 px-3 text-xs font-medium whitespace-nowrap text-subtle first:pl-5 last:pr-5",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  align,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <td
      className={cn(
        "h-12 border-b border-border px-3 text-fg first:pl-5 last:pr-5",
        align === "right" && "num text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-surface-2/60", className)} {...props} />;
}
