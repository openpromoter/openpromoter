import type { program } from "@openpromoter/db";
import { ArrowLeft } from "@openpromoter/ui/icons";
import Link from "next/link";
import { planStatus } from "@/server/billing-plans";
import { at, programBase } from "@/server/program-base";
import { BrandMark, BrandScope } from "./brand";
import { OfferStatement } from "./offer";

/**
 * Sign-in and password reset for a program's partners, in the founder's brand. Same frame as the
 * application page: the form on a white panel, the offer and what the portal holds beside it.
 */
export async function PartnerAuthShell({
  p,
  children,
}: {
  p: typeof program.$inferSelect;
  children: React.ReactNode;
}) {
  const { plan, hosted } = await planStatus(p.workspaceId);
  const home = at(await programBase(p));
  return (
    <BrandScope color={p.brand.color} className="min-h-dvh bg-canvas">
      <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,0.8fr)]">
        <div className="lg:py-2 lg:pl-2">
          <main className="flex min-h-dvh flex-col bg-surface lg:min-h-[calc(100dvh-16px)] lg:rounded-[14px] lg:border lg:border-border">
            <header className="flex h-16 items-center justify-between px-4 sm:px-10">
              <Link href={home} className="flex min-w-0 items-center gap-2.5">
                <BrandMark name={p.name} logoUrl={p.brand.logoUrl ?? null} size={26} />
                <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-fg">{p.name}</span>
              </Link>
              <Link
                href={home}
                className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-muted hover:text-fg"
              >
                <ArrowLeft className="size-4" /> Program page
              </Link>
            </header>
            <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center px-4 py-10 sm:px-0">
              {children}
            </div>
            {hosted && plan.id === "free" ? (
              <p className="px-4 pb-5 text-xs text-subtle sm:px-10">
                Powered by{" "}
                <a href="https://openpromoter.com" className="text-muted hover:text-fg">
                  OpenPromoter
                </a>
              </p>
            ) : null}
          </main>
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-0 flex h-dvh flex-col justify-center px-10 xl:px-16">
            <div className="mx-auto w-full max-w-[400px]">
              <p className="eyebrow">Your program</p>
              <OfferStatement p={p} className="mt-3" />
              <p className="eyebrow mt-10">In your portal</p>
              <ul className="mt-4 flex flex-col gap-4">
                {[
                  "Your referral link and QR code",
                  "Clicks and sales as they come in",
                  "Payouts and tax forms in one place",
                ].map((t, i) => (
                  <li key={t} className="flex gap-3 text-[13px] leading-5 text-muted">
                    <span className="num text-[12px] text-subtle">0{i + 1}</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>
      </div>
    </BrandScope>
  );
}
