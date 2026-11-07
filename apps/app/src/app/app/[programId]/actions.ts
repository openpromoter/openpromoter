"use server";

import { partner, partnerGroup, payout, savedView, user } from "@openpromoter/db";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createId } from "@/lib/id";
import { formatMoney, toMinor } from "@/lib/money";
import { HTTP_URL } from "@/lib/url";
import { audit } from "@/server/audit";
import { auth } from "@/server/auth";
import { actionCtx, safe } from "@/server/context";
import { db } from "@/server/db";
import {
  approveCommissions,
  createManualCommission,
  holdCommissions,
  releaseCommissions,
  reverseCommissions,
} from "@/server/ledger";
import { applyToProgram, createLink, createPromoCode, setPartnerStatus } from "@/server/partners";
import { approvePayouts, cancelPayout, createPayoutBatch, markPaid } from "@/server/payouts";
import { stripeFor } from "@/server/stripe-service";

const ids = z.array(z.string().max(40)).min(1).max(500);

export async function searchPartnersAction(programId: string, q: string) {
  return safe(async () => {
    await actionCtx(programId, "read");
    const term = `%${q.replace(/[%_]/g, "").slice(0, 60)}%`;
    return db()
      .select({ id: partner.id, name: partner.name, email: partner.email })
      .from(partner)
      .where(
        and(
          eq(partner.programId, programId),
          or(ilike(partner.name, term), ilike(partner.email, term), ilike(partner.code, term)),
        ),
      )
      .limit(8);
  });
}

/* ------------------------------------------------------------------ partners */

export async function invitePartnerAction(
  programId: string,
  input: { email: string; name: string; groupId?: string | null },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    const v = z
      .object({ email: z.email(), name: z.string().min(1).max(120), groupId: z.string().nullish() })
      .parse(input);
    if (v.groupId) await assertGroup(programId, v.groupId);
    const { partner: p, reason } = await applyToProgram(
      ctx.program,
      { email: v.email, name: v.name, source: "invite" },
      true,
    );
    if (reason === "Already applied")
      throw new Error(
        p.status === "pending"
          ? "That email has already applied. Approve them from the Needs approval tab."
          : `That email is already a partner here (${p.status}).`,
      );
    if (v.groupId) await db().update(partner).set({ groupId: v.groupId }).where(eq(partner.id, p.id));
    revalidatePath(`/app/${programId}/partners`);
    return p.id;
  }, "Partner invited");
}

/** A tier id from the browser must belong to this program. */
async function assertGroup(programId: string, groupId: string) {
  const [g] = await db()
    .select({ id: partnerGroup.id })
    .from(partnerGroup)
    .where(and(eq(partnerGroup.id, groupId), eq(partnerGroup.programId, programId)));
  if (!g) throw new Error("Tier not found");
}

export async function setPartnerStatusAction(
  programId: string,
  partnerIds: string[],
  status: "approved" | "rejected" | "paused" | "banned" | "pending",
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    const rows = await setPartnerStatus(
      programId,
      ids.parse(partnerIds),
      z.enum(["approved", "rejected", "paused", "banned", "pending"]).parse(status),
      ctx.actor,
    );
    revalidatePath(`/app/${programId}`, "layout");
    return rows.length;
  });
}

export async function updatePartnerAction(
  programId: string,
  partnerId: string,
  input: {
    groupId?: string | null;
    notes?: string | null;
    payoutMethod?: "stripe" | "paypal" | "wise" | "manual" | null;
    paypalEmail?: string | null;
    rate?: string | null;
  },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    const v = z
      .object({
        groupId: z.string().nullish(),
        notes: z.string().max(4000).nullish(),
        payoutMethod: z.enum(["stripe", "paypal", "wise", "manual"]).nullish(),
        paypalEmail: z.email().nullish().or(z.literal("")),
        rate: z
          .string()
          .regex(/^(\d+(\.\d{1,2})?)?$/, "Use a number like 35 or 12.5")
          .nullish(),
      })
      .parse(input);
    if (v.groupId) await assertGroup(programId, v.groupId);
    const { rate, ...rest } = v;
    const patch: Record<string, unknown> = Object.fromEntries(
      Object.entries(rest).filter(([, x]) => x !== undefined),
    );
    if (rate !== undefined)
      patch.commissionOverride = rate
        ? ctx.program.commissionType === "percent"
          ? Math.round(Number(rate) * 100)
          : toMinor(rate, ctx.program.currency)
        : null;
    await db()
      .update(partner)
      .set(patch)
      .where(and(eq(partner.id, partnerId), eq(partner.programId, programId)));
    revalidatePath(`/app/${programId}/partners/${partnerId}`);
    return true;
  }, "Saved");
}

/** GDPR erasure: removes personal data but keeps the money ledger intact for accounting. */
export async function anonymizePartnerAction(programId: string, partnerId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    await db()
      .update(partner)
      .set({
        name: "Deleted partner",
        email: `deleted-${partnerId}@invalid`,
        website: null,
        paypalEmail: null,
        wiseEmail: null,
        taxIdEnc: null,
        taxLegalName: null,
        taxAddress: null,
        vatId: null,
        notes: null,
        answers: {},
        signupIpHash: null,
        userId: null,
        status: "banned",
      })
      .where(and(eq(partner.id, partnerId), eq(partner.programId, programId)));
    await audit(ctx.program.workspaceId, ctx.actor, "partner.erase", { type: "partner", id: partnerId });
    revalidatePath(`/app/${programId}/partners`);
    return true;
  }, "Personal data erased");
}

export async function createLinkAction(
  programId: string,
  partnerId: string,
  input: { destination: string; subId?: string; label?: string; key?: string },
) {
  return safe(async () => {
    await actionCtx(programId, "partners.write");
    const v = z
      .object({
        destination: z.url(HTTP_URL),
        subId: z.string().max(64).optional(),
        label: z.string().max(80).optional(),
        key: z.string().max(32).optional(),
      })
      .parse(input);
    const l = await createLink(programId, partnerId, {
      ...v,
      key: v.key || null,
      subId: v.subId || null,
      label: v.label || null,
    });
    revalidatePath(`/app/${programId}/partners/${partnerId}`);
    return l;
  }, "Link created");
}

/** Creates the promotion code in Stripe too (when connected and a coupon id is given), so it works at checkout. */
export async function createPromoAction(
  programId: string,
  partnerId: string,
  input: { code: string; couponId?: string },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    const v = z
      .object({
        code: z.string().regex(/^[A-Za-z0-9_-]{3,32}$/, "Use 3-32 letters, numbers, - or _"),
        couponId: z.string().max(80).optional(),
      })
      .parse(input);
    const [own] = await db()
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.id, partnerId), eq(partner.programId, programId)));
    if (!own) throw new Error("Partner not found");
    let externalId: string | null = null;
    if (v.couponId) {
      const s = await stripeFor(ctx.program.workspaceId);
      if (!s) throw new Error("Connect Stripe to create the code there");
      const pc = await s.stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: v.couponId },
        code: v.code.toUpperCase(),
        metadata: { op_partner: partnerId },
      } as never);
      externalId = pc.id;
    }
    const row = await createPromoCode(programId, partnerId, v.code, externalId);
    if (!row) throw new Error("That code is already used in this program");
    revalidatePath(`/app/${programId}/partners/${partnerId}`);
    return row;
  }, "Coupon code added");
}

/* ------------------------------------------------------------------ commissions */

export async function commissionBulkAction(
  programId: string,
  action: "approve" | "hold" | "release" | "reverse",
  commissionIds: string[],
  reason?: string,
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "money.write");
    const list = ids.parse(commissionIds);
    const n =
      action === "approve"
        ? await approveCommissions(programId, list, ctx.actor)
        : action === "hold"
          ? await holdCommissions(programId, list, reason || "Held for review", ctx.actor)
          : action === "release"
            ? await releaseCommissions(programId, list, ctx.actor)
            : await reverseCommissions(programId, list, reason || "Reversed manually", ctx.actor);
    revalidatePath(`/app/${programId}/commissions`);
    return n;
  });
}

export async function manualCommissionAction(
  programId: string,
  input: { partnerId: string; amount: string; description: string },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "money.write");
    const v = z
      .object({
        partnerId: z.string(),
        amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
        description: z.string().min(1).max(200),
      })
      .parse(input);
    const c = await createManualCommission(
      programId,
      {
        partnerId: v.partnerId,
        amount: toMinor(v.amount, ctx.program.currency),
        description: v.description,
        kind: Number(v.amount) < 0 ? "adjustment" : "bonus",
      },
      ctx.actor,
    );
    revalidatePath(`/app/${programId}/commissions`);
    return c?.id;
  }, "Commission added");
}

/* ------------------------------------------------------------------ payouts */

export async function preparePayoutsAction(programId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "money.write");
    const batch = await createPayoutBatch(programId, ctx.actor);
    revalidatePath(`/app/${programId}`, "layout");
    return batch.length;
  });
}

export async function approvePayoutsAction(programId: string, payoutIds: string[], code?: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "money.write");
    const list = ids.parse(payoutIds);
    const rows = await db()
      .select({ amount: payout.amount })
      .from(payout)
      .where(
        and(
          eq(payout.programId, programId),
          inArray(payout.id, list),
          eq(payout.status, "awaiting_approval"),
        ),
      );
    const total = rows.reduce((a, r) => a + r.amount, 0);
    let verified = false;
    if (total > ctx.program.payoutTwoFactorAbove) {
      const [me] = await db()
        .select({ tf: user.twoFactorEnabled })
        .from(user)
        .where(eq(user.id, ctx.user.id));
      if (!me?.tf)
        throw new Error(
          `Turn on two-factor authentication (Settings > Account) to approve more than ${formatMoney(ctx.program.payoutTwoFactorAbove, ctx.program.currency)} at once.`,
        );
      if (!code) throw new Error("2FA_CODE_REQUIRED");
      try {
        await auth.api.verifyTOTP({
          body: {
            code: z
              .string()
              .regex(/^\d{6}$/)
              .parse(code),
          },
          headers: await headers(),
        });
      } catch {
        throw new Error("That two-factor code is not valid");
      }
      verified = true;
    }
    // the totals above can be stale; approvePayouts checks the locked amounts against the same limit
    const res = await approvePayouts(programId, list, ctx.actor, {
      limit: verified ? undefined : ctx.program.payoutTwoFactorAbove,
    });
    revalidatePath(`/app/${programId}`, "layout");
    return res;
  });
}

export async function markPaidAction(programId: string, payoutId: string, reference?: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "money.write");
    await markPaid(programId, payoutId, ctx.actor, reference?.slice(0, 120));
    revalidatePath(`/app/${programId}/payouts`);
    return true;
  }, "Marked as paid");
}

export async function cancelPayoutAction(programId: string, payoutId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "money.write");
    await cancelPayout(programId, payoutId, ctx.actor);
    revalidatePath(`/app/${programId}`, "layout");
    return true;
  }, "Payout canceled");
}

export async function retryPayoutAction(programId: string, payoutId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "money.write");
    const [po] = await db()
      .select()
      .from(payout)
      .where(and(eq(payout.id, payoutId), eq(payout.programId, programId), eq(payout.status, "failed")));
    if (!po) throw new Error("Only failed payouts can be retried");
    await db().update(payout).set({ status: "canceled" }).where(eq(payout.id, po.id));
    const batch = await createPayoutBatch(programId, ctx.actor, [po.partnerId]);
    revalidatePath(`/app/${programId}/payouts`);
    return batch.length;
  }, "Payout re-queued for approval");
}

/* ------------------------------------------------------------------ saved views */

export async function saveViewAction(programId: string, table: string, name: string, query: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "read");
    const v = z
      .object({ table: z.string().max(30), name: z.string().min(1).max(40), query: z.string().max(500) })
      .parse({ table, name, query });
    await db()
      .insert(savedView)
      .values({ id: createId("svw"), programId, userId: ctx.user.id, ...v });
    revalidatePath(`/app/${programId}/${table}`);
    return true;
  }, "View saved");
}

export async function deleteViewAction(programId: string, id: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "read");
    await db()
      .delete(savedView)
      .where(
        and(eq(savedView.id, id), eq(savedView.userId, ctx.user.id), eq(savedView.programId, programId)),
      );
    revalidatePath(`/app/${programId}`, "layout");
    return true;
  });
}
