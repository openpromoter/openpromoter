import { program } from "@openpromoter/db";
import { Button } from "@openpromoter/ui";
import { ArrowRight, ArrowUpRight } from "@openpromoter/ui/icons";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { planStatus } from "@/server/billing-plans";
import { db } from "@/server/db";
import { BrandMark } from "./brand";
import { OfferStatement, scheduleLabel } from "./offer";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [p] = await db().select().from(program).where(eq(program.slug, slug));
  return { title: p ? `${p.name} partner program` : "Partner program", description: p?.brand.description };
}

export default async function ProgramPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [p] = await db().select().from(program).where(eq(program.slug, slug));
  if (!p) notFound();
  const { plan, hosted } = await planStatus(p.workspaceId);
  const host = p.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const steps = [
    {
      title: "Apply in a minute",
      text:
        p.autoApprove.enabled && p.visibility !== "invite_only"
          ? "Most applications are approved on the spot, and your portal opens straight away."
          : "The team reviews every application and usually replies within a couple of days.",
    },
    {
      title: "Share your link",
      text: `Post it, add it to a video or print the QR code. Anyone who buys within ${p.cookieDays} days of clicking counts as yours.`,
    },
    {
      title: "Get paid",
      text: `Commissions clear after a ${p.holdDays}-day refund window and go out ${scheduleLabel(p).toLowerCase()} once you're owed ${formatMoney(p.minPayout, p.currency)}.`,
    },
  ];
  return (
    <div className="md:p-2">
      <main className="flex min-h-dvh flex-col bg-surface md:min-h-[calc(100dvh-16px)] md:rounded-[14px] md:border md:border-border">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-8">
          <Link href={p.websiteUrl} className="flex min-w-0 items-center gap-2.5">
            <BrandMark name={p.name} logoUrl={p.brand.logoUrl ?? null} size={28} />
            <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-fg">{p.name}</span>
            <span className="hidden text-[13px] text-subtle sm:inline">Partner program</span>
          </Link>
          <Button asChild variant="secondary">
            <Link href={`/p/${slug}/portal`}>Partner login</Link>
          </Button>
        </header>

        <section className="mx-auto grid w-full max-w-[1160px] gap-12 px-4 pt-12 pb-16 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:pt-20 lg:pb-24">
          <div className="flex flex-col justify-center">
            <span className="eyebrow">[ Partner program ]</span>
            <h1 className="mt-5 max-w-[17ch] text-[40px] leading-[44px] font-medium tracking-[-0.035em] text-balance text-fg sm:text-[52px] sm:leading-[56px]">
              {p.brand.headline ?? `Earn by recommending ${p.name}`}
            </h1>
            <p className="mt-5 max-w-[54ch] text-[16px] leading-7 text-muted">
              {p.brand.description ??
                `Refer customers to ${p.name} and earn a share of what they pay. Every sale is tracked straight from billing.`}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {p.visibility === "invite_only" ? (
                <p className="rounded-md border border-dashed border-border-strong px-3 py-2 text-[14px] text-muted">
                  This program is invite-only. Ask the {p.name} team for an invitation link.
                </p>
              ) : (
                <Button asChild variant="primary" size="lg" className="h-11 px-5 text-[14px]">
                  <Link href={`/p/${slug}/apply`}>
                    Become a partner <ArrowRight />
                  </Link>
                </Button>
              )}
              <Button asChild variant="ghost" size="lg" className="h-11 text-[14px]">
                <a href={p.websiteUrl} target="_blank" rel="noreferrer">
                  Visit {host} <ArrowUpRight />
                </a>
              </Button>
            </div>
            <dl className="mt-12 grid max-w-[480px] grid-cols-3 gap-4 border-t border-border pt-5">
              {[
                ["Approval", p.autoApprove.enabled ? "Instant" : "By the team"],
                ["Cookie", `${p.cookieDays} days`],
                ["Paid", scheduleLabel(p)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="eyebrow">{k}</dt>
                  <dd className="mt-1 text-[14px] font-medium text-fg">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-3 rounded-[22px] bg-canvas bg-[radial-gradient(var(--dot)_1.2px,transparent_1.4px)] bg-[length:10px_10px] sm:-inset-5"
            />
            <OfferStatement p={p} className="relative" />
          </div>
        </section>

        <section className="border-t border-border">
          <div className="mx-auto w-full max-w-[1160px] px-4 py-14 sm:px-8">
            <span className="eyebrow">How it works</span>
            <ol className="mt-6 grid gap-8 sm:grid-cols-3 sm:gap-10">
              {steps.map((s, i) => (
                <li key={s.title} className="border-t border-border-strong pt-4">
                  <span className="font-mono text-[12px] text-accent-text">0{i + 1}</span>
                  <h2 className="mt-3 text-[16px] font-medium tracking-[-0.01em] text-fg">{s.title}</h2>
                  <p className="mt-1.5 text-[14px] leading-6 text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {p.terms ? (
          <section id="terms" className="border-t border-border">
            <details className="group mx-auto w-full max-w-[1160px] px-4 py-6 sm:px-8">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-medium text-fg">
                Program terms
                <span className="text-[13px] font-normal text-subtle group-open:hidden">Read</span>
                <span className="hidden text-[13px] font-normal text-subtle group-open:inline">Hide</span>
              </summary>
              <p className="mt-4 max-w-[72ch] text-[14px] leading-6 whitespace-pre-line text-muted">
                {p.terms}
              </p>
            </details>
          </section>
        ) : null}

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-4 text-xs text-subtle sm:px-8">
          <span>
            {p.name} partner program · {host}
          </span>
          {hosted && plan.id === "free" ? (
            <span>
              Powered by{" "}
              <a href="https://openpromoter.com" className="text-muted hover:text-fg">
                OpenPromoter
              </a>
            </span>
          ) : null}
        </footer>
      </main>
    </div>
  );
}
