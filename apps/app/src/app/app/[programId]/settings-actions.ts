"use server";

import { resolveCname } from "node:dns/promises";
import {
  apiKey,
  billingConnection,
  billingPrice,
  invitation,
  member,
  PROGRAM_CATEGORIES,
  partnerGroup,
  payout,
  program,
  reportSubscription,
  user,
  webhookDelivery,
  webhookEndpoint,
} from "@openpromoter/db";
import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { encrypt, randomToken, sha256 } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { toMinor } from "@/lib/money";
import { priceLabel } from "@/lib/program-labels";
import { API_SCOPES } from "@/lib/scopes";
import { subdomainRoot } from "@/lib/subdomain";
import { HTTP_URL } from "@/lib/url";
import { assertPublicUrl, fetchSite } from "@/server/ai/brand";
import { audit } from "@/server/audit";
import { planStatus } from "@/server/billing-plans";
import { actionCtx, currentUser, safe, userPrograms } from "@/server/context";
import {
  addHostname,
  cloudflareOn,
  cnameTarget,
  hostnameProblem,
  removeHostname,
} from "@/server/custom-hostnames";
import { db } from "@/server/db";
import { sendNotice } from "@/server/email";
import { env, isHosted } from "@/server/env";
import { EVENT_TYPES } from "@/server/events";
import { enqueue } from "@/server/jobs";
import { createProgramFromUrl } from "@/server/setup";
import { connectStripeKey, importStripe, setWebhookSecret } from "@/server/stripe-service";

const rv = (programId: string, p = "/settings") => revalidatePath(`/app/${programId}${p}`, "layout");

const programSchema = z.object({
  name: z.string().min(1).max(80),
  websiteUrl: z.url(HTTP_URL),
  currency: z.string().length(3),
  commissionType: z.enum(["percent", "fixed"]),
  commissionValue: z.string().regex(/^\d+(\.\d{1,2})?$/),
  commissionDuration: z.enum(["once", "months", "lifetime"]),
  // the field is disabled (and not sent) unless the duration is "months"
  commissionMonths: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z.coerce.number().int().min(1).max(120).optional(),
  ),
  // empty: commissions stop after the months; disabled (not sent) unless the duration is "months"
  commissionAfterValue: z
    .string()
    .regex(/^(\d+(\.\d{1,2})?)?$/)
    .optional(),
  leadCommission: z.string().regex(/^\d+(\.\d{1,2})?$/),
  overridePercent: z.coerce.number().min(0).max(100).default(0),
  cookieDays: z.coerce.number().int().min(1).max(365),
  attributionModel: z.enum(["first_click", "last_click"]),
  referralParam: z.string().regex(/^[a-z_]{2,12}$/),
  holdDays: z.coerce.number().int().min(0).max(180),
  minPayout: z.string().regex(/^\d+(\.\d{1,2})?$/),
  payoutSchedule: z.enum(["manual", "monthly", "weekly"]),
  fraudHoldScore: z.coerce.number().int().min(10).max(100),
  visibility: z.enum(["public", "private", "invite_only"]),
  doubleSidedPercent: z.coerce.number().min(0).max(100),
  doubleSidedMonths: z.coerce.number().int().min(0).max(36),
  doubleSidedCoupon: z.string().max(80).optional(),
  terms: z.string().max(20000).optional(),
});

export async function updateProgramAction(programId: string, input: Record<string, string>) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const v = programSchema.parse(input);
    const cur = v.currency.toLowerCase();
    await db()
      .update(program)
      .set({
        name: v.name,
        websiteUrl: v.websiteUrl,
        currency: cur,
        commissionType: v.commissionType,
        commissionValue:
          v.commissionType === "percent"
            ? Math.round(Number(v.commissionValue) * 100)
            : toMinor(v.commissionValue, cur),
        commissionDuration: v.commissionDuration,
        ...(v.commissionMonths ? { commissionMonths: v.commissionMonths } : {}),
        ...(v.commissionAfterValue !== undefined
          ? {
              commissionAfterValue: !Number(v.commissionAfterValue)
                ? null
                : v.commissionType === "percent"
                  ? Math.round(Number(v.commissionAfterValue) * 100)
                  : toMinor(v.commissionAfterValue, cur),
            }
          : {}),
        leadCommission: toMinor(v.leadCommission, cur),
        overrideRate: Math.round(v.overridePercent * 100),
        cookieDays: v.cookieDays,
        attributionModel: v.attributionModel,
        referralParam: v.referralParam,
        holdDays: v.holdDays,
        minPayout: toMinor(v.minPayout, cur),
        payoutSchedule: v.payoutSchedule,
        fraudHoldScore: v.fraudHoldScore,
        visibility: v.visibility,
        doubleSided: {
          enabled: v.doubleSidedPercent > 0,
          percentOff: v.doubleSidedPercent,
          durationMonths: v.doubleSidedMonths,
          stripeCouponId: v.doubleSidedCoupon || null,
        },
        terms: v.terms ?? null,
      })
      .where(eq(program.id, programId));
    await audit(ctx.program.workspaceId, ctx.actor, "program.update", { type: "program", id: programId });
    rv(programId);
    return true;
  }, "Program saved");
}

export async function saveGroupAction(
  programId: string,
  input: { id?: string; name: string; rate: string; promoteAt: string; isDefault?: boolean },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const v = z
      .object({
        id: z.string().optional(),
        name: z.string().min(1).max(60),
        rate: z.string().regex(/^(\d+(\.\d{1,2})?)?$/),
        promoteAt: z.string().regex(/^(\d+(\.\d{1,2})?)?$/),
        isDefault: z.boolean().optional(),
      })
      .parse(input);
    const values = {
      name: v.name,
      commissionType: v.rate ? ("percent" as const) : null,
      commissionValue: v.rate ? Math.round(Number(v.rate) * 100) : null,
      promoteAtRevenue: v.promoteAt ? toMinor(v.promoteAt, ctx.program.currency) : null,
    };
    if (v.id)
      await db()
        .update(partnerGroup)
        .set(values)
        .where(and(eq(partnerGroup.id, v.id), eq(partnerGroup.programId, programId)));
    else {
      const [n] = await db()
        .select({ n: count() })
        .from(partnerGroup)
        .where(eq(partnerGroup.programId, programId));
      await db()
        .insert(partnerGroup)
        .values({ id: createId("grp"), programId, rank: n?.n ?? 0, ...values });
    }
    rv(programId);
    return true;
  }, "Tier saved");
}

export async function deleteGroupAction(programId: string, id: string) {
  return safe(async () => {
    await actionCtx(programId, "program.write");
    const [g] = await db()
      .select()
      .from(partnerGroup)
      .where(and(eq(partnerGroup.id, id), eq(partnerGroup.programId, programId)));
    if (g?.isDefault) throw new Error("The default tier can't be deleted");
    await db()
      .delete(partnerGroup)
      .where(and(eq(partnerGroup.id, id), eq(partnerGroup.programId, programId)));
    rv(programId);
    return true;
  }, "Tier deleted");
}

/** Add or update the rate for one billing price or product (keyed by its provider id). */
export async function saveProductRateAction(
  programId: string,
  input: { id: string; type: string; rate: string },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const v = z
      .object({
        id: z.string().trim().min(1).max(200),
        type: z.enum(["percent", "fixed"]),
        rate: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a rate"),
      })
      .parse(input);
    const value =
      v.type === "percent" ? Math.round(Number(v.rate) * 100) : toMinor(v.rate, ctx.program.currency);
    if (v.type === "percent" && value > 10_000) throw new Error("A percent rate can be at most 100%");
    const [price] = await db()
      .select()
      .from(billingPrice)
      .where(and(eq(billingPrice.workspaceId, ctx.program.workspaceId), eq(billingPrice.externalId, v.id)));
    const rates = ctx.program.productRates.filter((r) => r.id !== v.id);
    if (rates.length >= 100) throw new Error("A program can have up to 100 product rates");
    rates.push({ id: v.id, label: price ? priceLabel(price) : v.id, type: v.type, value });
    await db().update(program).set({ productRates: rates }).where(eq(program.id, programId));
    await audit(ctx.program.workspaceId, ctx.actor, "program.product_rate_save", {
      type: "program",
      id: programId,
    });
    rv(programId);
    return true;
  }, "Product rate saved");
}

export async function deleteProductRateAction(programId: string, id: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    await db()
      .update(program)
      .set({ productRates: ctx.program.productRates.filter((r) => r.id !== id) })
      .where(eq(program.id, programId));
    await audit(ctx.program.workspaceId, ctx.actor, "program.product_rate_delete", {
      type: "program",
      id: programId,
    });
    rv(programId);
    return true;
  }, "Product rate deleted");
}

export async function updateApplicationAction(
  programId: string,
  input: {
    questions: {
      id: string;
      label: string;
      type: "text" | "textarea" | "url" | "select" | "multi" | "checkbox";
      required: boolean;
      options?: string[];
    }[];
    autoApprove: {
      enabled: boolean;
      maxRiskScore: number;
      requireWebsite: boolean;
      blockedCountries: string[];
      allowedEmailDomains: string[];
    };
  },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const v = z
      .object({
        questions: z
          .array(
            z
              .object({
                id: z.string().max(40),
                label: z.string().min(1).max(200),
                type: z.enum(["text", "textarea", "url", "select", "multi", "checkbox"]),
                required: z.boolean(),
                options: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
              })
              .refine((q) => !["select", "multi"].includes(q.type) || (q.options?.length ?? 0) >= 2, {
                message: "Give each choice question at least two options",
              }),
          )
          .max(15),
        autoApprove: z.object({
          enabled: z.boolean(),
          maxRiskScore: z.number().int().min(0).max(100),
          requireWebsite: z.boolean(),
          blockedCountries: z.array(z.string().length(2)).max(250),
          allowedEmailDomains: z.array(z.string().max(100)).max(50),
        }),
      })
      .parse(input);
    await db()
      .update(program)
      .set({ applicationQuestions: v.questions, autoApprove: v.autoApprove })
      .where(eq(program.id, programId));
    await audit(ctx.program.workspaceId, ctx.actor, "program.application_update", {
      type: "program",
      id: programId,
    });
    rv(programId);
    return true;
  }, "Application settings saved");
}

export async function updateBrandingAction(
  programId: string,
  input: { color: string; logoUrl: string; headline: string; description: string },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const v = z
      .object({
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        logoUrl: z.url(HTTP_URL).or(z.literal("")),
        headline: z.string().max(120),
        description: z.string().max(600),
      })
      .parse(input);
    await db()
      .update(program)
      .set({
        brand: {
          ...ctx.program.brand,
          color: v.color.toUpperCase(),
          logoUrl: v.logoUrl || null,
          headline: v.headline,
          description: v.description,
        },
      })
      .where(eq(program.id, programId));
    await audit(ctx.program.workspaceId, ctx.actor, "program.branding", { type: "program", id: programId });
    rv(programId);
    return true;
  }, "Branding saved");
}

export async function refreshBrandingAction(programId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const s = await fetchSite(ctx.program.websiteUrl);
    await db()
      .update(program)
      .set({
        brand: {
          ...ctx.program.brand,
          color: s.color,
          logoUrl: s.logoUrl,
          description: s.description ?? ctx.program.brand.description,
        },
      })
      .where(eq(program.id, programId));
    rv(programId);
    return s;
  }, "Pulled branding from your site");
}

export async function setDomainAction(programId: string, domain: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const d = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
    if (d && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))
      throw new Error("Enter a domain like partners.yourapp.com");
    const root = subdomainRoot();
    if (d && root && (d === root || d.endsWith(`.${root}`)))
      throw new Error(`Use a domain you own. Your program already has a free address on ${root}.`);
    const old = ctx.program.customDomain;
    // on Cloud a custom domain is a paid feature (Starter and up); a domain already connected keeps working
    if (d && d !== old && isHosted() && (await planStatus(ctx.program.workspaceId)).plan.id === "free")
      throw new Error(
        "Custom domains come with the Starter plan and up. Upgrade in Settings > Plan & billing.",
      );
    if (d && d !== old) {
      const [taken] = await db()
        .select({ id: program.id })
        .from(program)
        .where(and(eq(program.customDomain, d), sql`${program.id} <> ${programId}`));
      if (taken) throw new Error("Another program already uses this domain");
    }
    if (cloudflareOn()) {
      if (d) await addHostname(d); // finds an existing one, so saving again re-registers a lost hostname
      if (old && old !== d) await removeHostname(old).catch(() => {});
    }
    await db()
      .update(program)
      .set({
        customDomain: d || null,
        customDomainVerifiedAt: d === old ? ctx.program.customDomainVerifiedAt : null,
      })
      .where(eq(program.id, programId));
    await audit(
      ctx.program.workspaceId,
      ctx.actor,
      "program.domain",
      { type: "program", id: programId },
      { domain: d },
    );
    rv(programId);
    return true;
  }, "Domain saved. Add the DNS record and verify it.");
}

export async function verifyDomainAction(programId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const d = ctx.program.customDomain;
    if (!d) throw new Error("Set a domain first");
    if (cloudflareOn()) {
      const problem = await hostnameProblem(d);
      if (problem) throw new Error(problem);
    } else {
      const target = cnameTarget();
      const records = await resolveCname(d).catch(() => [] as string[]);
      if (!records.some((r) => r.replace(/\.$/, "") === target))
        throw new Error(`No CNAME to ${target} found for ${d} yet. DNS can take a few minutes.`);
    }
    await db().update(program).set({ customDomainVerifiedAt: new Date() }).where(eq(program.id, programId));
    rv(programId);
    return true;
  }, "Domain verified");
}

/* ------------------------------------------------------------------ integrations */

export async function connectStripeSettingsAction(
  programId: string,
  input: { key: string; webhookSecret?: string },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    const v = z
      .object({ key: z.string().max(300), webhookSecret: z.string().max(200).optional() })
      .parse(input);
    if (!v.key && v.webhookSecret) {
      await setWebhookSecret(ctx.program.workspaceId, "stripe", v.webhookSecret.trim(), ctx.actor);
      rv(programId);
      return { webhookConfigured: true };
    }
    const r = await connectStripeKey(
      ctx.program.workspaceId,
      v.key.trim(),
      ctx.actor,
      v.webhookSecret?.trim() || null,
    );
    await enqueue("stripe.import", { workspaceId: ctx.program.workspaceId });
    rv(programId);
    return r;
  }, "Stripe connected. Importing products and customers in the background.");
}

export async function importStripeAction(programId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    const r = await importStripe(ctx.program.workspaceId);
    rv(programId);
    return r;
  }, "Import finished");
}

export async function connectProviderAction(
  programId: string,
  provider: "paddle" | "lemonsqueezy" | "polar" | "chargebee",
  webhookSecret: string,
  sandbox = false,
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    await setWebhookSecret(
      ctx.program.workspaceId,
      z.enum(["paddle", "lemonsqueezy", "polar", "chargebee"]).parse(provider),
      z.string().min(8).max(300).parse(webhookSecret.trim()),
      ctx.actor,
      null,
      // Lemon Squeezy flags test mode on every payload; the others need the Sandbox switch
      provider === "lemonsqueezy" ? true : !z.boolean().parse(sandbox),
    );
    rv(programId);
    return true;
  }, "Connected");
}

export async function connectPayoutProviderAction(
  programId: string,
  provider: "paypal" | "wise",
  input: Record<string, string>,
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "billing.write");
    const secret =
      provider === "paypal"
        ? z
            .object({
              clientId: z.string().min(5),
              clientSecret: z.string().min(5),
              sandbox: z.enum(["on", "off"]).optional(),
            })
            .parse(input)
        : z
            .object({
              token: z.string().min(10),
              profileId: z.string().min(1),
              sourceCurrency: z
                .string()
                .trim()
                .transform((v) => v.toUpperCase())
                .pipe(z.string().regex(/^([A-Z]{3})?$/, "Use a 3-letter currency code such as USD"))
                .optional(),
              sandbox: z.enum(["on", "off"]).optional(),
            })
            .parse(input);
    const value = JSON.stringify({ ...secret, sandbox: secret.sandbox === "on" });
    await verifyPayoutCredentials(provider, secret as Record<string, string>, secret.sandbox === "on");
    await db()
      .insert(billingConnection)
      .values({
        id: createId("bcn"),
        workspaceId: ctx.program.workspaceId,
        provider,
        mode: "api_key",
        secretEnc: encrypt(value),
      })
      .onConflictDoUpdate({
        target: [billingConnection.workspaceId, billingConnection.provider],
        set: { secretEnc: encrypt(value) },
      });
    await db()
      .update(program)
      .set({ payoutMethods: [...new Set([...ctx.program.payoutMethods, provider])] })
      .where(eq(program.id, programId));
    await audit(ctx.program.workspaceId, ctx.actor, "payouts.connect", {
      type: "billing_connection",
      id: provider,
    });
    rv(programId);
    return true;
  }, "Payout provider connected");
}

/** Ask PayPal or Wise whether the credentials work before saving them, so a typo fails here, not at payout time. */
async function verifyPayoutCredentials(
  provider: "paypal" | "wise",
  c: Record<string, string>,
  sandbox: boolean,
) {
  const opts = { signal: AbortSignal.timeout(15_000) };
  if (provider === "paypal") {
    const base = sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
    const res = await fetch(`${base}/v1/oauth2/token`, {
      ...opts,
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }).catch(() => null);
    if (!res) throw new Error("Couldn't reach PayPal. Try again.");
    if (!res.ok)
      throw new Error(
        `PayPal didn't accept these credentials${sandbox ? " (sandbox)" : ""}. Check the client ID and secret.`,
      );
    return;
  }
  const base = sandbox ? "https://api.wise-sandbox.com" : "https://api.wise.com";
  const res = await fetch(`${base}/v2/profiles`, {
    ...opts,
    headers: { Authorization: `Bearer ${c.token}` },
  }).catch(() => null);
  if (!res) throw new Error("Couldn't reach Wise. Try again.");
  if (!res.ok) throw new Error(`Wise didn't accept this API token${sandbox ? " (sandbox)" : ""}.`);
  const profiles = (await res.json().catch(() => [])) as { id: number }[];
  if (!profiles.some((p) => String(p.id) === String(c.profileId)))
    throw new Error("That profile ID isn't on this Wise account.");
}

export async function disconnectAction(
  programId: string,
  provider: "stripe" | "paddle" | "lemonsqueezy" | "polar" | "chargebee" | "paypal" | "wise",
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "billing.write");
    await db()
      .delete(billingConnection)
      .where(
        and(
          eq(billingConnection.workspaceId, ctx.program.workspaceId),
          eq(billingConnection.provider, provider),
        ),
      );
    await audit(ctx.program.workspaceId, ctx.actor, "billing.disconnect", {
      type: "billing_connection",
      id: provider,
    });
    rv(programId);
    return true;
  }, "Disconnected");
}

/* ------------------------------------------------------------------ webhooks + api keys */

export async function createEndpointAction(
  programId: string,
  input: { url: string; kind: "webhook" | "slack" | "discord"; events: string[] },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    const v = z
      .object({
        url: z.url(HTTP_URL),
        kind: z.enum(["webhook", "slack", "discord"]),
        events: z.array(z.enum([...EVENT_TYPES, "*"])).min(1),
      })
      .parse(input);
    if (env.HOSTED_MODE === "true") await assertPublicUrl(v.url);
    else if (!/^https?:\/\//.test(v.url)) throw new Error("Use an http(s) URL");
    const secret = `whsec_${randomToken(24)}`;
    await db()
      .insert(webhookEndpoint)
      .values({
        id: createId("whe"),
        workspaceId: ctx.program.workspaceId,
        url: v.url,
        kind: v.kind,
        secret,
        events: v.events,
      });
    await audit(ctx.program.workspaceId, ctx.actor, "webhook.create", {
      type: "webhook_endpoint",
      id: v.url,
    });
    rv(programId);
    return { secret };
  }, "Endpoint added");
}

export async function deleteEndpointAction(programId: string, id: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    await db()
      .delete(webhookEndpoint)
      .where(and(eq(webhookEndpoint.id, id), eq(webhookEndpoint.workspaceId, ctx.program.workspaceId)));
    await audit(ctx.program.workspaceId, ctx.actor, "webhook.delete", { type: "webhook_endpoint", id });
    rv(programId);
    return true;
  }, "Endpoint removed");
}

export async function testEndpointAction(programId: string, id: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    const [ep] = await db()
      .select()
      .from(webhookEndpoint)
      .where(and(eq(webhookEndpoint.id, id), eq(webhookEndpoint.workspaceId, ctx.program.workspaceId)));
    if (!ep) throw new Error("Endpoint not found");
    const did = createId("whd");
    await db()
      .insert(webhookDelivery)
      .values({
        id: did,
        endpointId: ep.id,
        event: "commission.created",
        payload: {
          id: did,
          type: "commission.created",
          test: true,
          created: Math.floor(Date.now() / 1000),
          data: { id: "com_test", amount: 4200, currency: ctx.program.currency, status: "pending" },
        },
      });
    await enqueue("webhook.deliver", { deliveryId: did });
    rv(programId);
    return true;
  }, "Test event queued");
}

export async function resendDeliveryAction(programId: string, deliveryId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    const [row] = await db()
      .select({ d: webhookDelivery })
      .from(webhookDelivery)
      .innerJoin(webhookEndpoint, eq(webhookEndpoint.id, webhookDelivery.endpointId))
      .where(
        and(eq(webhookDelivery.id, deliveryId), eq(webhookEndpoint.workspaceId, ctx.program.workspaceId)),
      );
    if (!row) throw new Error("Delivery not found");
    await db()
      .update(webhookDelivery)
      .set({ status: "pending", attempts: 0 })
      .where(eq(webhookDelivery.id, deliveryId));
    await enqueue("webhook.deliver", { deliveryId });
    rv(programId);
    return true;
  }, "Resend queued");
}

export async function createApiKeyAction(programId: string, input: { name: string; scopes: string[] }) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    const v = z
      .object({ name: z.string().min(1).max(60), scopes: z.array(z.enum(API_SCOPES)).min(1) })
      .parse(input);
    const raw = `op_${env.HOSTED_MODE === "true" ? "live" : "sk"}_${randomToken(24)}`;
    await db()
      .insert(apiKey)
      .values({
        id: createId("key"),
        workspaceId: ctx.program.workspaceId,
        name: v.name,
        prefix: raw.slice(0, 12),
        hash: sha256(raw),
        scopes: v.scopes,
        createdBy: ctx.user.id,
      });
    await audit(
      ctx.program.workspaceId,
      ctx.actor,
      "api_key.create",
      { type: "api_key", id: raw.slice(0, 12) },
      { scopes: v.scopes },
    );
    rv(programId);
    return { key: raw };
  }, "API key created. Copy it now; it won't be shown again.");
}

export async function revokeApiKeyAction(programId: string, id: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    await db()
      .update(apiKey)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKey.id, id), eq(apiKey.workspaceId, ctx.program.workspaceId)));
    await audit(ctx.program.workspaceId, ctx.actor, "api_key.revoke", { type: "api_key", id });
    rv(programId);
    return true;
  }, "Key revoked");
}

/* ------------------------------------------------------------------ team */

export async function inviteMemberAction(
  programId: string,
  input: { email: string; role: "admin" | "finance" | "viewer" | "owner" },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "team.write");
    const v = z
      .object({ email: z.email(), role: z.enum(["owner", "admin", "finance", "viewer"]) })
      .parse(input);
    if (v.role === "owner" && ctx.role !== "owner") throw new Error("Only owners can add owners");
    const token = randomToken(24);
    await db()
      .insert(invitation)
      .values({
        id: createId("inv"),
        workspaceId: ctx.program.workspaceId,
        email: v.email.toLowerCase(),
        role: v.role,
        tokenHash: sha256(token),
        invitedBy: ctx.user.id,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      });
    await sendNotice(v.email, `Join ${ctx.program.name} on OpenPromoter`, {
      brandName: "OpenPromoter",
      preview: "You're invited",
      title: `${ctx.user.name} invited you to ${ctx.program.name}`,
      paragraphs: [`You've been invited as ${v.role}. The invitation expires in 7 days.`],
      cta: { label: "Accept invitation", href: `${env.APP_URL}/invite/${token}` },
    });
    await audit(
      ctx.program.workspaceId,
      ctx.actor,
      "member.invite",
      { type: "invitation", id: v.email },
      { role: v.role },
    );
    rv(programId);
    return true;
  }, "Invitation sent");
}

export async function setMemberRoleAction(
  programId: string,
  userId: string,
  role: "owner" | "admin" | "finance" | "viewer" | "remove",
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "team.write");
    if (role === "owner" && ctx.role !== "owner") throw new Error("Only owners can make owners");
    const owners = await db()
      .select({ id: member.userId })
      .from(member)
      .where(and(eq(member.workspaceId, ctx.program.workspaceId), eq(member.role, "owner")));
    // admins manage the team, but only an owner may demote or remove an owner
    if (owners.some((o) => o.id === userId) && role !== "owner" && ctx.role !== "owner")
      throw new Error("Only owners can change an owner's role");
    if (owners.length === 1 && owners[0]!.id === userId && role !== "owner")
      throw new Error("A workspace needs at least one owner");
    if (role === "remove")
      await db()
        .delete(member)
        .where(and(eq(member.workspaceId, ctx.program.workspaceId), eq(member.userId, userId)));
    else
      await db()
        .update(member)
        .set({ role })
        .where(and(eq(member.workspaceId, ctx.program.workspaceId), eq(member.userId, userId)));
    await audit(ctx.program.workspaceId, ctx.actor, "member.role", { type: "user", id: userId }, { role });
    rv(programId);
    return true;
  }, "Team updated");
}

export async function acceptInviteAction(token: string) {
  return safe(async () => {
    const u = await currentUser();
    if (!u) throw new Error("Sign in first");
    const [inv] = await db()
      .select()
      .from(invitation)
      .where(eq(invitation.tokenHash, sha256(token)));
    const [me] = await db().select().from(user).where(eq(user.id, u.id));
    // opening the link again (a refresh, the redirect after signup) after joining is not an error
    if (inv?.acceptedAt && me?.email.toLowerCase() === inv.email) {
      const [joined] = await db()
        .select({ ws: member.workspaceId })
        .from(member)
        .where(and(eq(member.workspaceId, inv.workspaceId), eq(member.userId, u.id)));
      if (joined) return inv.workspaceId;
    }
    if (!inv || inv.acceptedAt || inv.expiresAt < new Date())
      throw new Error("This invitation is invalid or expired");
    if (me?.email.toLowerCase() !== inv.email) throw new Error(`This invitation is for ${inv.email}`);
    await db()
      .insert(member)
      .values({ workspaceId: inv.workspaceId, userId: u.id, role: inv.role })
      .onConflictDoNothing();
    await db().update(invitation).set({ acceptedAt: new Date() }).where(eq(invitation.id, inv.id));
    await audit(inv.workspaceId, { type: "user", id: u.id }, "member.join", { type: "user", id: u.id });
    return inv.workspaceId;
  });
}

/* ------------------------------------------------------------------ misc */

export async function subscribeReportAction(
  programId: string,
  email: string,
  frequency: "weekly" | "monthly" | "off",
) {
  return safe(
    async () => {
      const ctx = await actionCtx(programId, "read");
      // reports go only to the signed-in teammate: a viewer must not route analytics to an outside inbox
      if (email.trim().toLowerCase() !== ctx.user.email.toLowerCase())
        throw new Error("Reports can only be sent to your own email");
      const v = z
        .object({ email: z.email(), frequency: z.enum(["weekly", "monthly", "off"]) })
        .parse({ email: ctx.user.email, frequency });
      await db()
        .delete(reportSubscription)
        .where(and(eq(reportSubscription.programId, programId), eq(reportSubscription.email, v.email)));
      if (v.frequency !== "off")
        await db()
          .insert(reportSubscription)
          .values({
            id: createId("rpt"),
            programId,
            email: v.email,
            frequency: v.frequency,
            lastSentAt: new Date(),
          });
      rv(programId, "/analytics");
      return true;
    },
    frequency === "off" ? "Unsubscribed" : "You'll get the report by email",
  );
}

export async function createProgramAction(programId: string, input: { websiteUrl: string; name?: string }) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const v = z
      .object({ websiteUrl: z.string().min(3).max(300), name: z.string().max(80).optional() })
      .parse(input);
    const p = await createProgramFromUrl(ctx.user.id, v.websiteUrl, {
      workspaceId: ctx.program.workspaceId,
      name: v.name || undefined,
    });
    return p.id;
  }, "Program created");
}

export async function networkCategoryAction(programId: string, category: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const c = z
      .enum(PROGRAM_CATEGORIES)
      .nullable()
      .parse(category || null);
    await db().update(program).set({ category: c }).where(eq(program.id, programId));
    await audit(
      ctx.program.workspaceId,
      ctx.actor,
      "program.network",
      { type: "program", id: programId },
      { category: c },
    );
    rv(programId);
    return true;
  }, "Category saved");
}

export async function networkListingAction(programId: string, listed: boolean) {
  return safe(
    async () => {
      const ctx = await actionCtx(programId, "program.write");
      await db().update(program).set({ listedInNetwork: !!listed }).where(eq(program.id, programId));
      await audit(
        ctx.program.workspaceId,
        ctx.actor,
        "program.network",
        { type: "program", id: programId },
        { listed },
      );
      rv(programId);
      return true;
    },
    listed ? "Listed in the partner marketplace" : "Removed from the partner marketplace",
  );
}

export async function importPartnersAction(programId: string, csv: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    if (csv.length > 5_000_000) throw new Error("File too large (5 MB max)");
    const { importPartners } = await import("@/server/importer");
    const r = await importPartners(programId, csv, ctx.actor);
    rv(programId);
    return r;
  });
}

/** Removes everything created from Stripe test-mode events (test referrals and their commissions). */
export async function deleteTestDataAction(programId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const { commission, referral } = await import("@openpromoter/db");
    const c = await db()
      .delete(commission)
      .where(
        and(
          eq(commission.programId, programId),
          eq(commission.test, true),
          sql`${commission.payoutId} is null`,
        ),
      )
      .returning({ id: commission.id });
    const r = await db()
      .delete(referral)
      .where(and(eq(referral.programId, programId), eq(referral.test, true)))
      .returning({ id: referral.id });
    await audit(
      ctx.program.workspaceId,
      ctx.actor,
      "program.delete_test_data",
      { type: "program", id: programId },
      { commissions: c.length, referrals: r.length },
    );
    rv(programId);
    return { commissions: c.length, referrals: r.length };
  }, "Test data deleted");
}

/**
 * Deletes a program and everything in it (partners, commissions, payout history). Owners only, and only
 * when nothing is mid-payout, so money already on its way is never orphaned.
 */
export async function deleteProgramAction(programId: string, confirmName: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "billing.write");
    if (confirmName.trim() !== ctx.program.name)
      throw new Error("Type the program name exactly to delete it");
    const [busy] = await db()
      .select({ id: payout.id })
      .from(payout)
      .where(and(eq(payout.programId, programId), eq(payout.status, "processing")));
    if (busy) throw new Error("A payout is still being sent. Delete the program after it finishes.");
    await audit(
      ctx.program.workspaceId,
      ctx.actor,
      "program.delete",
      { type: "program", id: programId },
      {
        name: ctx.program.name,
      },
    );
    await db().delete(program).where(eq(program.id, programId));
    if (cloudflareOn() && ctx.program.customDomain)
      await removeHostname(ctx.program.customDomain).catch(() => {});
    const next = (await userPrograms(ctx.user.id))[0];
    return next ? `/app/${next.id}` : "/onboarding";
  }, "Program deleted");
}
