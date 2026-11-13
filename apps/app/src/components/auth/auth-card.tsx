import { Beacon, type BeaconPose } from "@openpromoter/ui";
import { Logo } from "@/components/logo";
import { PRODUCT } from "@/lib/config";
import { AuthScene, type SceneKind } from "./product-fragment";

const SCENE: Record<SceneKind, { pose: BeaconPose; line: string; facts: string[] }> = {
  signin: {
    pose: "hello",
    line: "Every commission traced to the invoice that created it.",
    facts: ["0% of payouts", "Open source", "Self-host free"],
  },
  signup: {
    pose: "celebrates",
    line: "From Stripe key to first partner in about five minutes.",
    facts: ["Free up to $1k a month", "No card", "0% of payouts"],
  },
};

/**
 * Split auth layout. The form sits on the page; the right panel stays ink in both themes, like the
 * website's header, with the site's ledger grid, one lit cell with Beacon's eyes and a scene from
 * the product. Sign-in shows a payout run, sign-up the setup steps. No motion.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  scene = "signin",
  bare = false,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scene?: SceneKind;
  /** Inside a program's own frame (PartnerAuthShell): the form only, without OpenPromoter's page and panel. */
  bare?: boolean;
}) {
  const s = SCENE[scene];
  if (bare)
    return (
      <>
        <h1 className="text-[28px] leading-9 font-medium tracking-[-0.03em] text-fg">{title}</h1>
        {subtitle ? <p className="mt-2 text-[14px] leading-[22px] text-muted">{subtitle}</p> : null}
        <div className="mt-8">{children}</div>
        {footer ? (
          <div className="mt-8 border-t border-border pt-5 text-[13px] text-muted">{footer}</div>
        ) : null}
      </>
    );
  return (
    <div className="min-h-dvh bg-surface lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex min-h-dvh flex-col px-6 py-6 sm:px-10">
        {/* The app's "/" only redirects back here, so the logo goes to the website, like most sign-in pages. */}
        <a href={`https://${PRODUCT.domain}/`} aria-label={`${PRODUCT.name} website`} className="self-start">
          <Logo />
        </a>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-12">
          <Beacon pose={s.pose} size={56} className="mb-5 lg:hidden" />
          <h1 className="text-[28px] leading-9 font-medium tracking-[-0.03em] text-fg">{title}</h1>
          {subtitle ? <p className="mt-2 text-[14px] leading-[22px] text-muted">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
          {footer ? (
            <div className="mt-8 border-t border-border pt-5 text-[13px] text-muted">{footer}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-xs text-subtle">
          <span>Open source under AGPL-3.0</span>
          <a href={PRODUCT.github} className="-my-2 ml-auto py-2 hover:text-fg">
            GitHub
          </a>
          <a href="https://openpromoter.com/docs/" className="-my-2 py-2 hover:text-fg">
            Docs
          </a>
        </div>
      </main>
      <aside className="hidden p-2 pl-0 lg:block" aria-hidden>
        <div className="auth-stage relative isolate flex h-full min-h-[calc(100dvh-16px)] flex-col overflow-hidden rounded-[16px] bg-[#0e0f11] text-white ring-1 ring-white/10">
          <div className="auth-grid absolute inset-0 -z-10" />
          {/* Lit cells on the grid, one with Beacon's eyes, as on the website's heroes. */}
          {[
            [5, 0],
            [6, 1],
            [4, 1],
          ].map(([c, r]) => (
            <span
              key={`${c}-${r}`}
              className="absolute -z-10 size-[87px] bg-white/[0.035]"
              style={{ left: (c as number) * 88 + 1, top: (r as number) * 88 + 1 }}
            />
          ))}
          <span
            className="absolute -z-10 flex size-[87px] items-center justify-center gap-[9px] bg-[#2442f5]"
            style={{ left: 5 * 88 + 1, top: 1 * 88 + 1 }}
          >
            <span className="h-[22px] w-[13px] rounded-full bg-white" />
            <span className="h-[22px] w-[13px] rounded-full bg-white" />
          </span>
          <div className="flex items-center justify-between px-8 pt-7 text-[12px] text-white/55">
            <span>[ openpromoter ]</span>
            <span className="num">v0.1 · AGPL-3.0</span>
          </div>
          <div className="flex flex-1 items-center justify-center px-10 py-10">
            <AuthScene kind={scene} pose={s.pose} />
          </div>
          <div className="px-8 pb-8">
            <p className="max-w-[460px] text-[26px] leading-[32px] font-medium tracking-[-0.025em]">
              {s.line}
            </p>
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-white/65">
              {s.facts.map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="size-1.5 bg-[#548dff]" /> {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
