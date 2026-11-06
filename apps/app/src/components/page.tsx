import { Badge, Card, cn, Tooltip } from "@openpromoter/ui";
import { type Icon, Info, TrendDown, TrendUp } from "@openpromoter/ui/icons";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-[24px] leading-8 font-medium tracking-[-0.025em] text-fg">{title}</h1>
        {description ? <p className="mt-1 max-w-[72ch] text-[14px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  delta,
  hint,
  invert,
  sub,
  icon: I,
  iconClass,
  spark,
  className,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  hint?: string;
  invert?: boolean;
  /** One sentence under the figure. Wrap the key phrase in <b>. */
  sub?: React.ReactNode;
  icon?: Icon;
  iconClass?: string;
  /** Rendered under the caption, usually a <DotSpark>. */
  spark?: React.ReactNode;
  className?: string;
}) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <Card className={cn("@container flex min-w-0 flex-col p-4 sm:p-5", className)}>
      <div className="flex min-h-5 items-center gap-2">
        {I ? (
          <I size={16} className={cn("shrink-0 text-subtle @max-[170px]:hidden", iconClass)} aria-hidden />
        ) : null}
        <span className="truncate text-[13px] text-muted">{label}</span>
        {hint ? (
          <Tooltip content={hint}>
            <button
              type="button"
              aria-label={`About ${label}`}
              className="relative text-subtle after:absolute after:-inset-2.5 after:content-[''] hover:text-fg"
            >
              <Info className="size-3.5" />
            </button>
          </Tooltip>
        ) : null}
        {delta != null ? (
          <Badge tone={good ? "success" : "danger"} className="num ml-auto gap-1" title="vs previous period">
            {delta >= 0 ? <TrendUp size={13} aria-hidden /> : <TrendDown size={13} aria-hidden />}
            {Math.abs(delta * 100).toFixed(1)}%
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col">
        {/* the figure scales with the card's own width, so a narrow card never cuts off "$132,456" */}
        <div className="figure mt-2 truncate text-[clamp(20px,13cqi,28px)] leading-8 text-fg">{value}</div>
        {sub ? (
          <div className="text-xs leading-4 text-subtle [&_b]:font-medium [&_b]:text-fg">{sub}</div>
        ) : delta != null ? (
          <div className="text-xs leading-4 text-subtle">vs the previous period</div>
        ) : null}
        {spark ? <div className="mt-auto hidden pt-4 sm:block">{spark}</div> : null}
      </div>
    </Card>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8", className)}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-medium tracking-[-0.015em] text-fg">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Two-column settings row: title/description left, fields right. */
export function SettingsCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="grid min-w-0 gap-4 p-5 md:grid-cols-3 md:gap-8">
      <div className="min-w-0">
        <h2 className="text-[14px] font-medium tracking-[-0.01em] text-fg">{title}</h2>
        {description ? <p className="mt-1 text-[13px] leading-5 text-muted">{description}</p> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4 md:col-span-2">
        {children}
        {footer ? <div className="flex justify-end gap-2 border-t border-border pt-4">{footer}</div> : null}
      </div>
    </Card>
  );
}

/** Statement line: label ········ amount. The product's signature row. */
export function LedgerLine({
  label,
  value,
  strong,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline text-[13px]", className)}>
      <span className={strong ? "font-medium text-fg" : "text-muted"}>{label}</span>
      <span className="leader" aria-hidden />
      <span className={cn("num", strong ? "font-medium text-fg" : "text-fg")}>{value}</span>
    </div>
  );
}
