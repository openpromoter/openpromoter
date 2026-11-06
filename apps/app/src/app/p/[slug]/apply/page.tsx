import { partner, program } from "@openpromoter/db";
import { ArrowLeft } from "@openpromoter/ui/icons";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { durationLabel, rateLabel } from "@/lib/program-labels";
import { currentUser } from "@/server/context";
import { db } from "@/server/db";
import { BrandMark } from "../brand";
import { OfferStatement } from "../offer";
import { ApplyForm } from "./form";

export const metadata: Metadata = { title: "Apply" };

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ invite?: string; email?: string; recruit?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const [p] = await db().select().from(program).where(eq(program.slug, slug));
  if (!p) notFound();
  const u = await currentUser();
  if (u) {
    const [existing] = await db()
      .select()
      .from(partner)
      .where(and(eq(partner.programId, p.id), eq(partner.userId, u.id)));
    if (existing) redirect(`/p/${slug}/portal`);
  }
  const instant = p.autoApprove.enabled && p.visibility !== "invite_only";
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,0.8fr)]">
      <div className="lg:py-2 lg:pl-2">
        <main className="flex min-h-dvh flex-col bg-surface lg:min-h-[calc(100dvh-16px)] lg:rounded-[14px] lg:border lg:border-border">
          <header className="flex h-16 items-center justify-between px-4 sm:px-10">
            <Link href={`/p/${slug}`} className="flex min-w-0 items-center gap-2.5">
              <BrandMark name={p.name} logoUrl={p.brand.logoUrl ?? null} size={26} />
              <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-fg">{p.name}</span>
            </Link>
            <Link
              href={`/p/${slug}`}
              className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-fg"
            >
              <ArrowLeft className="size-4" /> Program page
            </Link>
          </header>
          <div className="mx-auto w-full max-w-[560px] flex-1 px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
            <span className="eyebrow">Application</span>
            <h1 className="mt-3 text-[30px] leading-9 font-medium tracking-[-0.03em] text-fg">
              Join the {p.name} partner program
            </h1>
            <p className="mt-2 text-[15px] leading-6 text-muted">
              Earn <b className="font-medium text-fg">{rateLabel(p)}</b> {durationLabel(p)}.{" "}
              {instant
                ? "Most applications are approved instantly."
                : "We review applications within a couple of days."}
            </p>
            <OfferStatement p={p} className="mt-8 lg:hidden" />
            <ApplyForm
              slug={slug}
              signedIn={u ? { name: u.name, email: u.email } : null}
              invite={sp.invite ?? ""}
              recruit={sp.recruit?.slice(0, 64) ?? ""}
              email={sp.email ?? ""}
              questions={p.applicationQuestions}
              inviteOnly={p.visibility === "invite_only"}
              instant={instant}
            />
          </div>
        </main>
      </div>
      <aside className="hidden lg:block">
        <div className="sticky top-0 flex h-dvh flex-col justify-center px-10 xl:px-16">
          <div className="mx-auto w-full max-w-[400px]">
            <p className="eyebrow">What you get</p>
            <OfferStatement p={p} className="mt-3" />
            <p className="eyebrow mt-10">What happens next</p>
            <ol className="mt-4 flex flex-col gap-4">
              {[
                instant ? "You're approved the moment you apply." : "The team reviews your application.",
                "Your portal opens with your link, QR code and content kit.",
                "Every sale you refer shows up within seconds.",
              ].map((t, i) => (
                <li key={t} className="flex gap-3 text-[13px] leading-5 text-muted">
                  <span className="font-mono text-[12px] text-subtle">0{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}
