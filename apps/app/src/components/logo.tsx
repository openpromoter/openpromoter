import { PRODUCT } from "@/lib/config";

/**
 * Mark: Beacon's head. The body takes the text colour and the antenna dot the accent, so `color`
 * lets the partner portal use the founder's brand. Eyes take the page colour unless --eye is set.
 */
export function LogoMark({ size = 22, color = "var(--accent)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="6 0 52 52" aria-hidden>
      <path
        d="M32 16C32 12 33 9.5 35 7.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="36" cy="6.6" r="5.4" fill={color} />
      <rect x="12" y="15" width="40" height="37" rx="17" fill="currentColor" />
      <rect x="23" y="27.5" width="6" height="10" rx="3" fill="var(--eye, var(--bg))" />
      <rect x="35" y="27.5" width="6" height="10" rx="3" fill="var(--eye, var(--bg))" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-[15px] font-medium tracking-[-0.02em] text-fg ${className ?? ""}`}
    >
      {/* Lifted so the head, not the antenna box, is centred on the text. */}
      <span className="relative -top-[3px] inline-flex">
        <LogoMark />
      </span>
      {PRODUCT.name}
    </span>
  );
}
