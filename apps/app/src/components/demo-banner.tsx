/** Shown on every page of the public demo (server/demo.ts): what this is, and the way to your own. */
export function DemoBanner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-info-soft px-4 py-3 text-[13px] text-fg ${className}`}
    >
      <span>
        You're exploring the OpenPromoter demo with sample data. Look around freely: changes aren't saved and
        it resets every night.
      </span>
      <a
        href="https://app.openpromoter.com/signup"
        className="ml-auto inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-3 font-medium text-primary-fg hover:opacity-90"
      >
        Start free
      </a>
    </div>
  );
}
