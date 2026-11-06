import { Badge, EmptyState, StatusBadge } from "@openpromoter/ui";
import { Store } from "@openpromoter/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { rateLabel } from "@/lib/program-labels";
import { onColor } from "@/server/ai/brand";
import { currentUser } from "@/server/context";
import { listMarketplace, marketplaceCategories } from "@/server/marketplace";
import { BrandMark } from "../p/[slug]/brand";
import { termLabel } from "../p/[slug]/offer";
import { Filters, JoinButton } from "./client";

export const metadata: Metadata = {
  title: "Partner marketplace",
  description:
    "Affiliate programs from SaaS companies. Filter by category and commission type and apply in one click.",
};
export const dynamic = "force-dynamic";

const METHOD: Record<string, string> = { stripe: "Stripe", paypal: "PayPal", wise: "Wise", manual: "Bank" };
const list = (xs: string[]) =>
  xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? "Manual");

/** Opt-in marketplace: public programs whose founders switched the listing on in Settings. */
export default async function NetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const u = await currentUser();
  const [rows, categories] = await Promise.all([
    listMarketplace({ category: sp.category, type: sp.type }, u?.id),
    marketplaceCategories(),
  ]);
  const filtered = !!(sp.category || sp.type);
  return (
    <div className="min-h-dvh bg-canvas md:p-2">
      <main className="flex min-h-dvh flex-col bg-surface md:min-h-[calc(100dvh-16px)] md:rounded-[14px] md:border md:border-border">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-border px-4 sm:px-8">
          <Link href="/">
            <Logo />
          </Link>
          {u ? (
            <Link href="/partners" className="text-[13px] text-muted hover:text-fg">
              Your programs
            </Link>
          ) : (
            <Link href="/login?next=/network" className="text-[13px] text-muted hover:text-fg">
              Sign in
            </Link>
          )}
        </header>
        <div className="mx-auto w-full max-w-[1100px] px-4 py-12 sm:px-8 sm:py-16">
          <span className="eyebrow">[ Partner marketplace ]</span>
          <h1 className="mt-4 max-w-[20ch] text-[36px] leading-10 font-medium tracking-[-0.035em] text-fg">
            SaaS programs that pay you every month
          </h1>
          <p className="mt-3 max-w-[60ch] text-[15px] leading-6 text-muted">
            Affiliate programs you can join today. Every one pays through OpenPromoter with no fees taken from
            your commissions.{" "}
            {u ? "Apply with one click from your account." : "Sign in to apply with one click."}
          </p>
          <div className="mt-8">
            <Filters categories={categories} category={sp.category ?? ""} type={sp.type ?? ""} />
          </div>
          {rows.length ? (
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map(({ program: p, status }) => (
                <li key={p.id} className="flex h-full flex-col rounded-xl border border-border bg-surface">
                  <div className="flex items-center gap-3 px-5 pt-5">
                    {p.brand.logoUrl ? (
                      <BrandMark name={p.name} logoUrl={p.brand.logoUrl} size={32} />
                    ) : (
                      <span
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-[13px] font-medium"
                        style={{ background: p.brand.color, color: onColor(p.brand.color) }}
                      >
                        {p.name[0]?.toUpperCase()}
                      </span>
                    )}
                    <Link
                      href={`/p/${p.slug}`}
                      className="min-w-0 flex-1 truncate text-[14px] font-medium text-fg hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.category ? <Badge>{p.category}</Badge> : null}
                  </div>
                  <div className="mt-3 flex-1 px-5">
                    <p className="line-clamp-2 text-[13px] leading-5 text-muted">
                      {p.brand.description ?? `Earn by recommending ${p.name}.`}
                    </p>
                  </div>
                  <div className="mt-5 flex flex-col gap-2 border-t border-border px-5 py-3.5">
                    <div className="flex items-baseline text-[13px]">
                      <span className="text-muted">Commission</span>
                      <span className="leader" aria-hidden />
                      <span className="num font-medium text-fg">{rateLabel(p)}</span>
                    </div>
                    <div className="flex items-baseline text-[13px]">
                      <span className="text-muted">Paid for</span>
                      <span className="leader" aria-hidden />
                      <span className="text-fg">{termLabel(p)}</span>
                    </div>
                    <div className="flex items-baseline text-[13px]">
                      <span className="text-muted">Cookie</span>
                      <span className="leader" aria-hidden />
                      <span className="num text-fg">{p.cookieDays} days</span>
                    </div>
                    <div className="flex items-baseline text-[13px]">
                      <span className="text-muted">Payouts</span>
                      <span className="leader" aria-hidden />
                      <span className="text-fg">{list(p.payoutMethods.map((m) => METHOD[m] ?? m))}</span>
                    </div>
                    {p.overrideRate > 0 ? (
                      <div className="flex items-baseline text-[13px]">
                        <span className="text-muted">Recruit bonus</span>
                        <span className="leader" aria-hidden />
                        <span className="num text-fg">{p.overrideRate / 100}%</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                    {status ? (
                      <>
                        <StatusBadge status={status === "approved" ? "active" : status} />
                        <Link
                          href={`/p/${p.slug}/portal`}
                          className="text-[13px] font-medium text-accent-text hover:underline"
                        >
                          Open portal
                        </Link>
                      </>
                    ) : (
                      <>
                        <Link href={`/p/${p.slug}`} className="text-[13px] text-muted hover:text-fg">
                          Program details
                        </Link>
                        {u && !p.applicationQuestions.some((q) => q.required) ? (
                          <JoinButton slug={p.slug} name={p.name} />
                        ) : (
                          <Link
                            href={`/p/${p.slug}/apply`}
                            className="inline-flex h-7 items-center rounded-[5px] bg-primary px-2.5 text-xs font-medium text-primary-fg hover:bg-primary-hover"
                          >
                            Apply
                          </Link>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Store}
              mascot="thinking"
              title={filtered ? "No programs match these filters" : "No programs are listed yet"}
              description={
                filtered
                  ? "Try another category or commission type."
                  : "Founders can list their program from Settings. Check back soon."
              }
              className="mt-6 rounded-xl border border-dashed border-border-strong"
            />
          )}
        </div>
      </main>
    </div>
  );
}
