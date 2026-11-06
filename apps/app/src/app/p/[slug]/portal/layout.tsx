import { partner, program } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { planStatus } from "@/server/billing-plans";
import { partnerCtx } from "@/server/context";
import { db } from "@/server/db";
import { BrandMark } from "../brand";
import { PortalShell } from "./nav";

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await partnerCtx(slug);
  const others = await db()
    .select({ slug: program.slug, name: program.name })
    .from(partner)
    .innerJoin(program, eq(program.id, partner.programId))
    .where(eq(partner.userId, ctx.user.id));
  const { plan, hosted } = await planStatus(ctx.program.workspaceId);
  return (
    <PortalShell
      slug={slug}
      name={ctx.program.name}
      logo={<BrandMark name={ctx.program.name} logoUrl={ctx.program.brand.logoUrl ?? null} size={28} />}
      user={ctx.user.name}
      email={ctx.user.email}
      programs={others}
      recruiting={ctx.program.overrideRate > 0}
      banner={
        ctx.partner.status !== "approved" ? (
          <div className="flex items-center gap-2.5 border-b border-border bg-warning-soft px-4 py-2.5 text-[13px] text-warning md:px-8">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
            {ctx.partner.status === "pending"
              ? "Your application is being reviewed. You'll get an email when you're approved."
              : `Your partner account is ${ctx.partner.status}.`}
          </div>
        ) : null
      }
      footer={
        hosted && plan.id === "free" ? (
          <footer className="border-t border-border px-4 py-4 text-xs text-subtle md:px-8">
            Powered by{" "}
            <a href="https://openpromoter.com" className="text-muted hover:text-fg">
              OpenPromoter
            </a>
          </footer>
        ) : null
      }
    >
      {children}
    </PortalShell>
  );
}
