import { billingConnection, program } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { snippets } from "@/lib/install";
import { AccessError, requireProgram } from "@/server/access";
import { requireUser, userPrograms } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { stripeOAuthUrl, webhookUrl } from "@/server/stripe-service";
import { Wizard } from "./wizard";

export const metadata: Metadata = { title: "Set up your program" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; step?: string }>;
}) {
  const u = await requireUser("/onboarding");
  const sp = await searchParams;
  // Setup without a program id creates a program, so only a first-time founder may start it. Signing in
  // again (the sign-up page sends Google and GitHub users here) must land on the existing program.
  // Further programs start from Settings > Programs, which passes their id.
  if (!sp.program) {
    const [first] = await userPrograms(u.id);
    if (first) redirect(`/app/${first.id}`);
  }
  let initial: Parameters<typeof Wizard>[0]["initial"] = null;
  if (sp.program) {
    // a deleted, foreign or made-up program id (an old tab, a shared link) goes to the founder's own
    // setup instead of a bare 404; /onboarding then opens their program or starts a fresh one
    const access = await requireProgram(u.id, sp.program, "read").catch((e) => {
      if (e instanceof AccessError) return null;
      throw e;
    });
    if (!access) redirect("/onboarding");
    const { program: p } = access;
    const [conn] = await db()
      .select()
      .from(billingConnection)
      .where(and(eq(billingConnection.workspaceId, p.workspaceId), eq(billingConnection.provider, "stripe")));
    const [fresh] = await db().select().from(program).where(eq(program.id, p.id));
    initial = {
      programId: p.id,
      name: p.name,
      color: p.brand.color,
      logoUrl: p.brand.logoUrl ?? null,
      stripeConnected: !!conn?.secretEnc,
      webhookUrl: webhookUrl("stripe", p.workspaceId),
      // set only when STRIPE_CONNECT_CLIENT_ID is configured; the callback brings the founder back here
      oauthUrl: conn?.secretEnc ? null : stripeOAuthUrl(`${p.workspaceId}:${p.id}:onboarding`),
      installed: !!fresh?.installVerifiedAt,
      snippets: snippets(
        env.APP_URL,
        p.slug,
        p.id,
        p.doubleSided.enabled ? p.doubleSided.stripeCouponId : null,
      ),
      step: Number(sp.step ?? 2),
    };
  }
  return <Wizard initial={initial} userName={u.name} appUrl={env.APP_URL} />;
}
