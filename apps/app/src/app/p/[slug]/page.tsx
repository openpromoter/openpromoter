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
import { programBase } from "@/server/program-base";
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
  const base = await programBase(p);
  const { plan, hosted } = await planStatus(p.workspaceId);
  const host = p.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const money = (cents: number) => formatMoney(cents, p.currency);
  const percent = p.commissionType === "percent";
  const sale = 10_000; // the same $100 example the statement uses
  const earns = percent ? Math.round((sale * p.commissionValue) / 10_000) : p.commissionValue;
  const instant = p.autoApprove.enabled && p.visibility !== "invite_only";
  const schedule = scheduleLabel(p).toLowerCase();

  // One sale, start to finish, in this program's own numbers.
  const sale_steps: { when: string; title: string; text: string; amount?: string; yours?: boolean }[] = [
    { when: "Day 0", title: "You share", text: "Post your link, add it to a video or print the QR code." },
    {
      when: `Within ${p.cookieDays} days`,
      title: "They buy",
      text: "The sale is tracked from billing and counts as yours.",
      amount: percent ? `${money(sale)} sale` : undefined,
    },
    {
      when: `${p.holdDays} days later`,
      title: "It clears",
      text: "The refund window ends and your commission is approved.",
      amount: `${money(earns)} yours`,
      yours: true,
    },
    {
      when: scheduleLabel(p),
      title: "You get paid",
      text: `Payouts go out ${schedule} once you're owed ${money(p.minPayout)}.`,
    },
  ];

  // What that adds up to. Skipped when the rate changes part-way: one number would mislead.
  const payments = !percent
    ? 1
    : p.commissionDuration === "months"
      ? p.commissionMonths
      : p.commissionDuration === "lifetime"
        ? 12
        : 1;
  const span = !percent
    ? "per customer"
    : p.commissionDuration === "months"
      ? `over ${p.commissionMonths} months`
      : p.commissionDuration === "lifetime"
        ? "every year"
        : "on first payments";
  const totals = p.commissionAfterValue ? [] : [1, 10, 50].map((n) => [n, n * earns * payments] as const);
  const link = { rel: "nofollow ugc noopener" }; // the founder typed this URL: it earns no ranking credit from us

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,0.8fr)]">
      <div className="lg:py-2 lg:pl-2">
        <main className="flex min-h-dvh flex-col bg-surface lg:min-h-[calc(100dvh-16px)] lg:rounded-[14px] lg:border lg:border-border">
          <header className="flex h-16 items-center justify-between px-4 sm:px-10">
            <a href={p.websiteUrl} {...link} className="flex min-w-0 items-center gap-2.5">
              <BrandMark name={p.name} logoUrl={p.brand.logoUrl ?? null} size={26} />
              <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-fg">{p.name}</span>
            </a>
            <Button asChild variant="secondary">
              <Link href={`${base}/portal`}>Partner login</Link>
            </Button>
          </header>

          <div className="mx-auto w-full max-w-[640px] flex-1 px-4 sm:px-10">
            <section className="pt-12 pb-14 sm:pt-20 sm:pb-20">
              <p className="eyebrow">Partner program</p>
              <h1 className="mt-4 text-[38px] leading-[42px] font-medium tracking-[-0.035em] text-balance text-fg sm:text-[50px] sm:leading-[54px]">
                {p.brand.headline ?? `Earn by recommending ${p.name}`}
              </h1>
              <p className="mt-5 max-w-[52ch] text-[16px] leading-7 text-muted">
                {p.brand.description ??
                  `Refer customers to ${p.name} and earn a share of what they pay. Every sale is tracked straight from billing.`}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
                {p.visibility === "invite_only" ? (
                  <p className="rounded-md border border-dashed border-border-strong px-3 py-2 text-[14px] text-muted">
                    This program is invite-only. Ask the {p.name} team for an invitation link.
                  </p>
                ) : (
                  <Button asChild variant="primary" size="lg" className="h-11 px-5 text-[14px]">
                    <Link href={`${base}/apply`}>
                      Become a partner <ArrowRight />
                    </Link>
                  </Button>
                )}
                <Button asChild variant="ghost" size="lg" className="h-11 text-[14px]">
                  <a href={p.websiteUrl} target="_blank" {...link}>
                    Visit {host} <ArrowUpRight />
                  </a>
                </Button>
              </div>
              {p.visibility === "invite_only" ? null : (
                <p className="mt-4 text-[13px] leading-5 text-subtle">
                  {instant
                    ? "Applying takes a minute and most partners are approved on the spot."
                    : "Applying takes a minute. The team reviews every application."}
                </p>
              )}
            </section>

            {/* phones and tablets: the offer sits in the flow; on desktop it stays beside the page */}
            <OfferStatement p={p} className="mb-14 lg:hidden" />

            <section aria-labelledby="sale-h" className="border-t border-border py-12">
              <h2 id="sale-h" className="text-[20px] leading-7 font-medium tracking-[-0.02em] text-fg">
                Follow one sale
              </h2>
              <p className="mt-1 text-[14px] leading-6 text-muted">
                {percent
                  ? `What happens when someone you send pays ${money(sale)}.`
                  : "What happens when someone you send becomes a customer."}
              </p>
              <ol className="mt-6">
                {sale_steps.map((x) => (
                  <li
                    key={x.title}
                    className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-border py-4 sm:grid-cols-[132px_1fr_auto]"
                  >
                    <span className="col-span-2 font-mono text-[12px] leading-6 text-subtle sm:col-span-1">
                      {x.when}
                    </span>
                    <span>
                      <span className="block text-[15px] leading-6 font-medium text-fg">{x.title}</span>
                      <span className="block text-[14px] leading-6 text-muted">{x.text}</span>
                    </span>
                    <span
                      className={`num text-right text-[14px] leading-6 ${x.yours ? "font-medium text-accent-text" : "text-muted"}`}
                    >
                      {x.amount}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            {totals.length ? (
              <section aria-labelledby="sum-h" className="border-t border-border py-12">
                <h2 id="sum-h" className="text-[20px] leading-7 font-medium tracking-[-0.02em] text-fg">
                  What it adds up to
                </h2>
                <p className="mt-1 text-[14px] leading-6 text-muted">
                  {percent
                    ? `An example for customers who pay ${money(sale)}${payments > 1 ? " a month" : ""}.`
                    : "A fixed amount for every customer you refer."}
                </p>
                <dl className="mt-6 grid grid-cols-3 border-y border-border">
                  {totals.map(([n, total], i) => (
                    <div key={n} className={`min-w-0 py-5 ${i ? "border-l border-border pl-3 sm:pl-6" : ""}`}>
                      <dt className="text-[13px] leading-5 text-muted">
                        {n} {n === 1 ? "customer" : "customers"}
                      </dt>
                      <dd className="figure mt-1 text-[20px] leading-7 text-fg sm:text-[30px] sm:leading-9">
                        {money(total).replace(/\.00$/, "")}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[13px] leading-5 text-subtle">You earn this {span}.</p>
              </section>
            ) : null}

            {p.terms ? (
              <section id="terms" className="border-t border-border">
                <details className="group py-6">
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
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-4 text-xs text-subtle sm:px-10">
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
      <aside className="hidden lg:block">
        <div className="sticky top-0 flex h-dvh flex-col justify-center px-10 xl:px-16">
          <div className="mx-auto w-full max-w-[400px]">
            <p className="eyebrow">The offer</p>
            <OfferStatement p={p} className="mt-3" />
          </div>
        </div>
      </aside>
    </div>
  );
}
