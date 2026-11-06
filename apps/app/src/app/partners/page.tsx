import { partner, program } from "@openpromoter/db";
import { EmptyState, StatusBadge } from "@openpromoter/ui";
import { ArrowRight, Users } from "@openpromoter/ui/icons";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { durationLabel, rateLabel } from "@/lib/program-labels";
import { onColor } from "@/server/ai/brand";
import { requireUser } from "@/server/context";
import { db } from "@/server/db";

/** One login, many programs: every program this person partners with. */
export default async function PartnerHome() {
  const u = await requireUser("/partners");
  const rows = await db()
    .select({ p: program, pt: partner })
    .from(partner)
    .innerJoin(program, eq(program.id, partner.programId))
    .where(eq(partner.userId, u.id));
  return (
    <div className="min-h-dvh bg-canvas md:p-2">
      <main className="flex min-h-dvh flex-col bg-surface md:min-h-[calc(100dvh-16px)] md:rounded-[14px] md:border md:border-border">
        <header className="flex h-16 items-center justify-between border-b border-border px-4 sm:px-8">
          <Logo />
          <span className="truncate text-[13px] text-subtle">{u.email}</span>
        </header>
        <div className="mx-auto w-full max-w-[720px] px-4 py-12 sm:px-6 sm:py-16">
          <span className="eyebrow">Partner home</span>
          <h1 className="mt-3 text-[28px] leading-9 font-medium tracking-[-0.03em] text-fg">
            Your partner programs
          </h1>
          <p className="mt-2 text-[14px] text-muted">
            One login for every program you promote. Pick one to open its portal, or{" "}
            <Link href="/network" className="text-accent-text hover:underline">
              find more in the marketplace
            </Link>
            .
          </p>
          {rows.length ? (
            <ul className="mt-8 overflow-hidden rounded-xl border border-border ">
              {rows.map(({ p, pt }) => (
                <li key={p.id} className="border-b border-border last:border-b-0">
                  <Link
                    href={`/p/${p.slug}/portal`}
                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2"
                  >
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-[14px] font-medium"
                      style={{ background: p.brand.color, color: onColor(p.brand.color) }}
                    >
                      {p.name[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-fg">{p.name}</span>
                      <span className="block truncate text-[13px] text-subtle">
                        {rateLabel(p)} {durationLabel(p)}
                      </span>
                    </span>
                    <StatusBadge status={pt.status === "approved" ? "active" : pt.status} />
                    <ArrowRight className="size-4 text-subtle transition-colors group-hover:text-fg" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Users}
              mascot="hello"
              title="No programs yet"
              description="When you join a partner program, it shows up here."
              className="mt-8 rounded-xl border border-dashed border-border-strong"
              action={
                <Link href="/network" className="text-[13px] font-medium text-accent-text hover:underline">
                  Browse the partner marketplace
                </Link>
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}
