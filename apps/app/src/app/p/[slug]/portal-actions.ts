"use server";

import {
  billingConnection,
  bountySubmission,
  campaign,
  message,
  partner,
  program,
  prospect,
} from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { applicationAnswer } from "@/lib/application-answer";
import { encrypt } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { audit } from "@/server/audit";
import { auth } from "@/server/auth";
import { captchaFor, verifyCaptcha } from "@/server/captcha";
import { currentUser, partnerCtx, safe } from "@/server/context";
import { db } from "@/server/db";
import { applyToProgram, createLink } from "@/server/partners";
import { programBase } from "@/server/program-base";
import { clientIp, limit } from "@/server/ratelimit";
import { programUrl } from "@/server/ref-link";
import { partnerOnboardingLink } from "@/server/stripe-service";

export async function applyAction(slug: string, input: Record<string, string>) {
  return safe(async () => {
    const h = await headers();
    // shared limiter (Postgres) and the trusted-hop client IP, so replicas agree and the header can't be spoofed
    const ip = clientIp({ headers: h }) ?? "unknown";
    if (!(await limit(`apply:${ip}`, 10, 3_600_000)).ok)
      throw new Error("Too many applications from this network. Try again later.");
    if (captchaFor(h) && !(await verifyCaptcha(input["cf-turnstile-response"], ip === "unknown" ? null : ip)))
      throw new Error("Please complete the check above the button and try again.");
    const [p] = await db().select().from(program).where(eq(program.slug, slug));
    if (!p) throw new Error("Program not found");
    const base = z
      .object({
        name: z.string().min(1).max(120),
        email: z.email(),
        website: z.string().max(300).optional(),
        country: z.string().max(2).optional(),
        password: z.string().max(200).optional(),
        invite: z.string().max(40).optional(),
        recruit: z.string().max(64).optional(),
        terms: z.literal("on"),
      })
      .parse(input);
    // an invite-only program opens only to a recruiter prospect id of this program
    const [invite] = base.invite
      ? await db()
          .select({ id: prospect.id })
          .from(prospect)
          .where(and(eq(prospect.id, base.invite), eq(prospect.programId, p.id)))
      : [];
    if (p.visibility === "invite_only" && !invite) throw new Error("This program is invite-only.");
    const answers: Record<string, string> = {};
    for (const q of p.applicationQuestions) {
      const v = applicationAnswer(q, input[`q_${q.id}`] ?? "");
      if (q.required && !v) throw new Error(`Please answer: ${q.label}`);
      if (v) answers[q.id] = v;
    }
    let u: { id: string; email: string } | null = await currentUser();
    if (!u) {
      if (!base.password || base.password.length < 8)
        throw new Error("Choose a password of at least 8 characters");
      const res = await auth.api
        .signUpEmail({ body: { name: base.name, email: base.email, password: base.password }, headers: h })
        .catch((e: Error) => {
          throw new Error(
            /exist/i.test(e.message)
              ? "You already have an account. Please sign in before you apply."
              : e.message,
          );
        });
      u = { id: res.user.id, email: res.user.email };
    }
    const { partner: pt, autoApproved } = await applyToProgram(
      p,
      {
        email: u!.email,
        name: base.name,
        website: base.website || null,
        country: base.country || null,
        answers,
        userId: u!.id,
        ip,
        source: invite ? "recruiter" : "application",
        recruiterCode: base.recruit || null,
      },
      !!invite,
    );
    return { autoApproved, partnerId: pt.id };
  });
}

export async function partnerLinkAction(
  slug: string,
  input: { destination: string; subId?: string; label?: string },
) {
  return safe(async () => {
    const ctx = await partnerCtx(slug);
    if (ctx.partner.status !== "approved") throw new Error("Your account isn't active yet");
    const v = z
      .object({
        destination: z.url({ protocol: /^https?$/ }),
        subId: z.string().max(64).optional(),
        label: z.string().max(80).optional(),
      })
      .parse(input);
    const l = await createLink(ctx.program.id, ctx.partner.id, {
      destination: v.destination,
      subId: v.subId || null,
      label: v.label || null,
    });
    revalidatePath(`/p/${slug}/portal`, "layout");
    return l.key;
  }, "Link created");
}

export async function payoutMethodAction(
  slug: string,
  input: { method: "paypal" | "wise" | "manual"; email?: string },
) {
  return safe(async () => {
    const ctx = await partnerCtx(slug);
    const v = z
      .object({ method: z.enum(["paypal", "wise", "manual"]), email: z.email().optional() })
      .parse(input);
    if (v.method !== "manual" && !v.email) throw new Error("Enter the email for your account");
    if (v.method !== "manual") {
      // the same rule the payouts page uses to list methods: enabled by the founder and connected
      const [conn] = await db()
        .select({ secret: billingConnection.secretEnc })
        .from(billingConnection)
        .where(
          and(
            eq(billingConnection.workspaceId, ctx.program.workspaceId),
            eq(billingConnection.provider, v.method),
          ),
        );
      if (!ctx.program.payoutMethods.includes(v.method) || !conn?.secret)
        throw new Error("This program doesn't pay out that way");
    }
    await db()
      .update(partner)
      .set({
        payoutMethod: v.method,
        ...(v.method === "paypal"
          ? { paypalEmail: v.email }
          : v.method === "wise"
            ? { wiseEmail: v.email }
            : {}),
      })
      .where(eq(partner.id, ctx.partner.id));
    await audit(
      ctx.program.workspaceId,
      ctx.actor,
      "partner.payout_method",
      { type: "partner", id: ctx.partner.id },
      { method: v.method },
    );
    revalidatePath(`/p/${slug}/portal`, "layout");
    return true;
  }, "Payout method saved");
}

export async function stripeOnboardingAction(slug: string) {
  return safe(async () => {
    const ctx = await partnerCtx(slug);
    // back to the host the partner is signed in on: their program's own domain or the app
    const base = await programBase(ctx.program);
    const back = base ? `/p/${slug}/portal/payouts` : programUrl(ctx.program, "/portal/payouts");
    return partnerOnboardingLink(ctx.program.id, ctx.partner.id, back);
  });
}

export async function taxFormAction(slug: string, input: Record<string, string>) {
  return safe(async () => {
    const ctx = await partnerCtx(slug);
    const v = z
      .object({
        form: z.enum(["w9", "w8ben", "w8bene"]),
        legalName: z.string().min(2).max(200),
        address: z.string().min(5).max(500),
        country: z.string().length(2),
        tin: z.string().max(40).optional(),
        vatId: z.string().max(20).optional(),
        certify: z.literal("on"),
      })
      .parse(input);
    if (v.form === "w9" && !/^\d{3}-?\d{2}-?\d{4}$|^\d{2}-?\d{7}$/.test(v.tin ?? ""))
      throw new Error("Enter a valid SSN (123-45-6789) or EIN (12-3456789)");
    await db()
      .update(partner)
      .set({
        taxFormType: v.form,
        taxFormStatus: "submitted",
        taxLegalName: v.legalName,
        taxAddress: v.address,
        country: v.country.toUpperCase(),
        taxIdEnc: v.tin ? encrypt(v.tin.replace(/-/g, "")) : null,
        vatId: v.vatId?.toUpperCase().replace(/\s/g, "") || null,
      })
      .where(eq(partner.id, ctx.partner.id));
    await audit(
      ctx.program.workspaceId,
      ctx.actor,
      "partner.tax_form",
      { type: "partner", id: ctx.partner.id },
      { form: v.form },
    );
    revalidatePath(`/p/${slug}/portal/settings`);
    return true;
  }, "Tax details saved");
}

export async function partnerReplyAction(slug: string, body: string) {
  return safe(async () => {
    const ctx = await partnerCtx(slug);
    if (ctx.partner.status === "rejected" || ctx.partner.status === "banned")
      throw new Error("Your account isn't active");
    await db()
      .insert(message)
      .values({
        id: createId("msg"),
        programId: ctx.program.id,
        partnerId: ctx.partner.id,
        fromPartner: true,
        authorId: ctx.user.id,
        body: z.string().min(1).max(5000).parse(body),
      });
    revalidatePath(`/p/${slug}/portal/messages`);
    return true;
  }, "Message sent");
}

export async function submitBountyAction(slug: string, campaignId: string, url: string, note?: string) {
  return safe(async () => {
    const ctx = await partnerCtx(slug);
    if (ctx.partner.status !== "approved") throw new Error("Your account isn't active yet");
    const [c] = await db()
      .select()
      .from(campaign)
      .where(
        and(
          eq(campaign.id, campaignId),
          eq(campaign.programId, ctx.program.id),
          eq(campaign.status, "active"),
        ),
      );
    if (c?.rule.kind !== "bounty" || c.rule.trigger !== "post") throw new Error("This bounty isn't open");
    await db()
      .insert(bountySubmission)
      .values({
        id: createId("bty"),
        campaignId,
        partnerId: ctx.partner.id,
        url: z.url({ protocol: /^https?$/ }).parse(url),
        note: note?.slice(0, 500),
      });
    revalidatePath(`/p/${slug}/portal`);
    return true;
  }, "Submitted for review");
}
