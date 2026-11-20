"use server";

import { program, user } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ProgramDesign } from "@/server/ai/designer";
import { actionCtx, currentUser, safe, userPrograms } from "@/server/context";
import { db } from "@/server/db";
import { applyDesign, createProgramFromUrl, proposeDesign, workspaceCreators } from "@/server/setup";
import { connectStripeKey, importStripe } from "@/server/stripe-service";

export async function createProgramAction(input: { websiteUrl: string; name?: string }) {
  return safe(async () => {
    const u = await currentUser();
    if (!u) throw new Error("Please sign in again");
    const { websiteUrl, name } = z
      .object({ websiteUrl: z.string().min(3).max(300), name: z.string().max(80).optional() })
      .parse(input);
    // two tabs on the empty first step must not make two programs: the second submit resumes the first.
    // ponytail: check-then-insert, so two submits in the same instant can still both create; a unique
    // index on the owner would close that if it ever happens.
    const [existing] = await userPrograms(u.id);
    if (existing)
      return {
        programId: existing.id,
        name: existing.name,
        color: existing.color.color,
        logoUrl: existing.color.logoUrl ?? null,
      };
    // a listed owner proves the address with a password reset: it reaches the inbox, sets the password and
    // signs out every other session, so an account someone else registered under it is taken back. Read
    // from the table: the session cookie can lag behind the reset for a minute.
    if (workspaceCreators().includes(u.email.toLowerCase())) {
      const [me] = await db().select({ proven: user.addressProvenAt }).from(user).where(eq(user.id, u.id));
      if (!me?.proven)
        throw new Error(
          `Confirm you own ${u.email} first: sign out, choose "Forgot password" on the sign-in page, set a new password from the email, then sign in and try again.`,
        );
    }
    const p = await createProgramFromUrl(u.id, websiteUrl, { name });
    return { programId: p.id, name: p.name, color: p.brand.color, logoUrl: p.brand.logoUrl ?? null };
  });
}

export async function connectStripeAction(programId: string, input: { key: string; webhookSecret?: string }) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "developer.write");
    const v = z
      .object({ key: z.string().min(20).max(300), webhookSecret: z.string().max(200).optional() })
      .parse(input);
    const res = await connectStripeKey(
      ctx.program.workspaceId,
      v.key.trim(),
      ctx.actor,
      v.webhookSecret?.trim() || null,
    );
    const imported = await importStripe(ctx.program.workspaceId).catch((e: Error) => ({ error: e.message }));
    return { ...res, imported };
  });
}

export async function proposeDesignAction(programId: string) {
  return safe(async () => {
    await actionCtx(programId, "read");
    return proposeDesign(programId);
  });
}

export async function acceptDesignAction(programId: string, design: ProgramDesign) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    await applyDesign(programId, design, ctx.actor);
    return true;
  });
}

export async function installStatusAction(programId: string) {
  return safe(async () => {
    await actionCtx(programId, "read");
    const [p] = await db()
      .select({ at: program.installVerifiedAt })
      .from(program)
      .where(eq(program.id, programId));
    return { verified: !!p?.at };
  });
}
