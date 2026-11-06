import { cn } from "@openpromoter/ui";
import { onColor, readableOnWhite } from "@/server/ai/brand";

/**
 * Re-skins everything inside with the founder's colour: the accent, focus ring, soft tint and the
 * active chart series. Dark mode lifts the text tint so links stay readable on the dark panel.
 */
export function BrandScope({
  color,
  className,
  children,
}: {
  color: string;
  className?: string;
  children: React.ReactNode;
}) {
  const c = /^#[0-9a-f]{6}$/i.test(color) ? color : "#2442F5"; // validated hex only: safe to inline
  // the founder's colour drives both the button (primary) and the data accent inside the portal
  const css = `[data-brand]{--primary:${c};--primary-hover:color-mix(in srgb,${c} 88%,#000);--primary-fg:${onColor(c)};--accent-text:${readableOnWhite(c)};--accent-soft:color-mix(in srgb,${c} 9%,var(--surface));--accent:${c};--accent-hover:color-mix(in srgb,${c} 88%,#000);--accent-fg:${onColor(c)};--accent-text:${readableOnWhite(c)};--accent-soft:color-mix(in srgb,${c} 9%,var(--surface));--ring:${c};--chart-1:${c}}.dark [data-brand]{--primary-hover:color-mix(in srgb,${c} 88%,#fff);--accent-text:color-mix(in srgb,${c} 55%,#fff);--accent-soft:color-mix(in srgb,${c} 16%,var(--surface));--accent-text:color-mix(in srgb,${c} 55%,#fff);--accent-soft:color-mix(in srgb,${c} 16%,var(--surface));--chart-1:color-mix(in srgb,${c} 82%,#fff)}`;
  return (
    <div data-brand className={cn(className)}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: colour is a validated hex */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {children}
    </div>
  );
}

/** The founder's logo, or a brand-coloured monogram tile when there is none. */
export function BrandMark({
  name,
  logoUrl,
  size = 28,
}: {
  name: string;
  logoUrl: string | null;
  size?: number;
}) {
  // logos saved before the http(s)-only check could hold javascript: or data: URLs; show the monogram instead
  return logoUrl && /^https?:\/\//i.test(logoUrl) ? (
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-md border border-border bg-surface object-contain"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary font-medium text-primary-fg"
      style={{ width: size, height: size, fontSize: size * 0.46 }}
    >
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
