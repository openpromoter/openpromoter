"use server";

import { z } from "zod";
import { checkoutUrl, portalUrl, setBillingRegion } from "@/server/billing-plans";
import { actionCtx, safe } from "@/server/context";

export async function choosePlanAction(programId: string, plan: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "billing.write");
    return checkoutUrl(
      ctx.program.workspaceId,
      z.enum(["free", "starter", "growth", "scale"]).parse(plan),
      ctx.user.email,
      `/app/${programId}/settings/billing`,
    );
  });
}

export async function billingPortalAction(programId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "billing.write");
    return portalUrl(ctx.program.workspaceId, `/app/${programId}/settings/billing`);
  });
}

export async function billingRegionAction(programId: string, region: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "billing.write");
    await setBillingRegion(ctx.program.workspaceId, z.enum(["abroad", "in_home", "in_other"]).parse(region));
  }, "Saved");
}
