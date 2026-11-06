"use server";

import {
  campaign,
  commission,
  contentAsset,
  fraudFlag,
  partner,
  program,
  prospect,
  resource,
} from "@openpromoter/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createId } from "@/lib/id";
import { HTTP_URL } from "@/lib/url";
import { ask } from "@/server/ai/assistant";
import { applyAction, dismissAction, runAutopilot, undoAction } from "@/server/ai/autopilot";
import { generateContentKit } from "@/server/ai/content";
import {
  findCreatorProspects,
  findCustomerProspects,
  inviteTemplate,
  personalise,
  sendInvites,
} from "@/server/ai/recruiter";
import { audit } from "@/server/audit";
import { type CampaignDraft, createCampaign, draftCampaign, reviewSubmission } from "@/server/campaigns";
import { actionCtx, safe } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { rescoreProgram } from "@/server/fraud-run";
import { releaseCommissions } from "@/server/ledger";
import { sendMessage, setPartnerStatus } from "@/server/partners";
import { importStripe } from "@/server/stripe-service";

const rv = (programId: string, path = "") =>
  revalidatePath(`/app/${programId}${path}`, path ? "page" : "layout");

/* ------------------------------------------------------------------ autopilot */

export async function runAutopilotAction(programId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    if (!ctx.program.autopilotEnabled) throw new Error("Autopilot is off. Switch it on to run it.");
    const r = await runAutopilot(programId);
    rv(programId);
    return r;
  });
}

export async function agentAction_(programId: string, actionId: string, op: "apply" | "undo" | "dismiss") {
  return safe(
    async () => {
      const ctx = await actionCtx(programId, "partners.write");
      if (op === "apply") await applyAction(programId, actionId, ctx.actor);
      else if (op === "undo") await undoAction(programId, actionId, ctx.actor);
      else await dismissAction(programId, actionId);
      rv(programId);
      return true;
    },
    op === "apply" ? "Done. You can undo it from the log." : op === "undo" ? "Undone" : "Dismissed",
  );
}

export async function autopilotSettingsAction(
  programId: string,
  input: { enabled: boolean; mode: "suggest" | "act" },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const v = z.object({ enabled: z.boolean(), mode: z.enum(["suggest", "act"]) }).parse(input);
    await db()
      .update(program)
      .set({ autopilotEnabled: v.enabled, autopilotMode: v.mode })
      .where(eq(program.id, programId));
    await audit(
      ctx.program.workspaceId,
      ctx.actor,
      "autopilot.settings",
      { type: "program", id: programId },
      v,
    );
    rv(programId, "/autopilot");
    return true;
  }, "Autopilot updated");
}

/* ------------------------------------------------------------------ recruiter */

export async function findProspectsAction(
  programId: string,
  source: "customers" | "creators",
  niche?: string,
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    if (source === "customers") {
      await importStripe(ctx.program.workspaceId).catch(() => null);
      return findCustomerProspects(ctx.program);
    }
    return findCreatorProspects(ctx.program, z.string().min(2).max(200).parse(niche));
  });
}

export async function addProspectAction(
  programId: string,
  input: { name: string; email: string; url?: string; reason?: string },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    const v = z
      .object({
        name: z.string().min(1).max(120),
        email: z.email(),
        url: z.string().max(300).optional(),
        reason: z.string().max(300).optional(),
      })
      .parse(input);
    const reason = v.reason || "Added by you.";
    const t = inviteTemplate(ctx.program, { name: v.name, source: "creator", reason });
    await db()
      .insert(prospect)
      .values({
        id: createId("pro"),
        programId,
        source: "manual",
        name: v.name,
        email: v.email.toLowerCase(),
        url: v.url || null,
        reason,
        score: 60,
        inviteSubject: t.subject,
        inviteBody: t.body,
      })
      .onConflictDoNothing();
    rv(programId, "/recruiter");
    return true;
  }, "Prospect added");
}

export async function updateProspectAction(
  programId: string,
  id: string,
  input: { inviteSubject?: string; inviteBody?: string; status?: "dismissed" | "new" },
) {
  return safe(async () => {
    await actionCtx(programId, "partners.write");
    const v = z
      .object({
        inviteSubject: z.string().max(200).optional(),
        inviteBody: z.string().max(5000).optional(),
        status: z.enum(["dismissed", "new"]).optional(),
      })
      .parse(input);
    await db()
      .update(prospect)
      .set(v)
      .where(and(eq(prospect.id, id), eq(prospect.programId, programId)));
    rv(programId, "/recruiter");
    return true;
  });
}

export async function personaliseAction(programId: string, ids: string[]) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    const rows = await db()
      .select()
      .from(prospect)
      .where(and(eq(prospect.programId, programId), inArray(prospect.id, ids.slice(0, 25))));
    let n = 0;
    for (const p of rows) if (await personalise(ctx.program, p)) n++;
    if (n === 0)
      throw new Error(
        "Personalising needs an AI provider. The drafted templates are ready to send as they are.",
      );
    rv(programId, "/recruiter");
    return n;
  }, "Invites personalised");
}

export async function sendInvitesAction(programId: string, ids: string[]) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "partners.write");
    const n = await sendInvites(ctx.program, z.array(z.string()).min(1).max(200).parse(ids), ctx.actor);
    rv(programId, "/recruiter");
    return n;
  });
}

/* ------------------------------------------------------------------ campaigns */

export async function draftCampaignAction(programId: string, text: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const d = await draftCampaign(
      z.string().min(3).max(300).parse(text),
      ctx.program.currency,
      undefined,
      ctx.program.workspaceId,
    );
    if (!d)
      throw new Error(
        'Couldn\'t turn that into a campaign. Try "Double commissions on annual plans this month" or "$5 per signup for 14 days".',
      );
    return { ...d, startsAt: d.startsAt.toISOString(), endsAt: d.endsAt?.toISOString() ?? null };
  });
}

export async function createCampaignAction(
  programId: string,
  d: {
    name: string;
    description: string;
    rule: CampaignDraft["rule"];
    startsAt: string;
    endsAt: string | null;
  },
) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const c = await createCampaign(
      programId,
      {
        ...d,
        name: d.name.slice(0, 120),
        startsAt: new Date(d.startsAt),
        endsAt: d.endsAt ? new Date(d.endsAt) : null,
      },
      ctx.actor,
    );
    const targets = await db()
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.programId, programId), eq(partner.status, "approved")));
    if (targets.length)
      await sendMessage(ctx.program, {
        partnerId: null,
        subject: `New: ${c.name}`,
        body: `${d.description}\n\nIt's live now${d.endsAt ? ` until ${new Date(d.endsAt).toLocaleDateString("en-US", { dateStyle: "medium" })}` : ""}.`,
        authorId: ctx.user.id,
      });
    rv(programId, "/campaigns");
    return c.id;
  }, "Campaign launched and partners notified");
}

export async function endCampaignAction(programId: string, id: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    await db()
      .update(campaign)
      .set({ endsAt: new Date(), status: "ended" })
      .where(and(eq(campaign.id, id), eq(campaign.programId, programId)));
    await audit(ctx.program.workspaceId, ctx.actor, "campaign.end", { type: "campaign", id });
    rv(programId, "/campaigns");
    return true;
  }, "Campaign ended");
}

export async function reviewSubmissionAction(programId: string, id: string, approve: boolean) {
  return safe(
    async () => {
      const ctx = await actionCtx(programId, "money.write");
      await reviewSubmission(programId, id, approve, ctx.actor);
      rv(programId, "/campaigns");
      return true;
    },
    approve ? "Bounty approved" : "Submission rejected",
  );
}

/* ------------------------------------------------------------------ content */

export async function regenerateContentAction(programId: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "program.write");
    const r = await generateContentKit(ctx.program, { force: true });
    rv(programId, "/content");
    return r.count;
  }, "Content kit refreshed");
}

export async function saveAssetAction(
  programId: string,
  input: { id?: string; kind: "swipe" | "social" | "email" | "comparison"; title: string; body: string },
) {
  return safe(async () => {
    await actionCtx(programId, "program.write");
    const v = z
      .object({
        id: z.string().optional(),
        kind: z.enum(["swipe", "social", "email", "comparison"]),
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(8000),
      })
      .parse(input);
    if (v.id)
      await db()
        .update(contentAsset)
        .set({ title: v.title, body: v.body, kind: v.kind, generatedBy: "user" })
        .where(and(eq(contentAsset.id, v.id), eq(contentAsset.programId, programId)));
    else
      await db()
        .insert(contentAsset)
        .values({
          id: createId("cnt"),
          programId,
          kind: v.kind,
          title: v.title,
          body: v.body,
          generatedBy: "user",
        });
    rv(programId, "/content");
    return true;
  }, "Saved");
}

export async function deleteAssetAction(programId: string, id: string) {
  return safe(async () => {
    await actionCtx(programId, "program.write");
    await db()
      .delete(contentAsset)
      .where(and(eq(contentAsset.id, id), eq(contentAsset.programId, programId)));
    rv(programId, "/content");
    return true;
  }, "Deleted");
}

/** Creatives partners can download: images, PDFs, short videos and zipped brand kits. */
const RESOURCE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "application/zip",
];
const RESOURCE_MAX_BYTES = 10 * 1024 * 1024;

export async function addResourceAction(
  programId: string,
  input: { title: string; url?: string; description?: string; file?: File | null },
) {
  return safe(async () => {
    await actionCtx(programId, "program.write");
    const file = input.file && input.file.size > 0 ? input.file : null;
    const v = z
      .object({
        title: z.string().min(1).max(120),
        url: file ? z.string().optional() : z.url(HTTP_URL),
        description: z.string().max(300).optional(),
      })
      .parse({ title: input.title, url: input.url, description: input.description });
    const id = createId("res");
    if (file) {
      if (file.size > RESOURCE_MAX_BYTES) throw new Error("Files can be up to 10 MB.");
      if (!RESOURCE_TYPES.includes(file.type))
        throw new Error("Upload an image, PDF, MP4 or WebM video, or a ZIP file.");
    }
    await db()
      .insert(resource)
      .values({
        id,
        programId,
        title: v.title,
        description: v.description,
        url: file ? `${env.APP_URL}/api/resources/${id}` : (v.url as string),
        ...(file
          ? {
              fileName: file.name.slice(0, 200),
              fileType: file.type,
              fileData: Buffer.from(await file.arrayBuffer()),
            }
          : {}),
      });
    rv(programId, "/content");
    return true;
  }, "Resource added");
}

export async function deleteResourceAction(programId: string, id: string) {
  return safe(async () => {
    await actionCtx(programId, "program.write");
    await db()
      .delete(resource)
      .where(and(eq(resource.id, id), eq(resource.programId, programId)));
    rv(programId, "/content");
    return true;
  });
}

/* ------------------------------------------------------------------ messages */

export async function sendMessageAction(
  programId: string,
  input: { partnerId: string | null; subject?: string; body: string },
) {
  return safe(
    async () => {
      const ctx = await actionCtx(programId, "partners.write");
      const v = z
        .object({
          partnerId: z.string().nullable(),
          subject: z.string().max(200).optional(),
          body: z.string().min(1).max(8000),
        })
        .parse(input);
      if (v.partnerId) {
        const [p] = await db()
          .select({ id: partner.id })
          .from(partner)
          .where(and(eq(partner.id, v.partnerId), eq(partner.programId, programId)));
        if (!p) throw new Error("Partner not found");
      }
      await sendMessage(ctx.program, { ...v, authorId: ctx.user.id });
      rv(programId, "/messages");
      return true;
    },
    input.partnerId ? "Message sent" : "Announcement sent",
  );
}

/* ------------------------------------------------------------------ fraud */

export async function rescoreAction(programId: string) {
  return safe(async () => {
    await actionCtx(programId, "partners.write");
    const n = await rescoreProgram(programId);
    rv(programId);
    return n;
  }, "Fraud checks re-run");
}

export async function resolveFlagAction(
  programId: string,
  flagId: string,
  resolution: "dismissed" | "confirmed",
) {
  return safe(
    async () => {
      const ctx = await actionCtx(programId, "partners.write");
      const [f] = await db()
        .update(fraudFlag)
        .set({ resolution })
        .where(and(eq(fraudFlag.id, flagId), eq(fraudFlag.programId, programId)))
        .returning();
      if (!f) throw new Error("Flag not found");
      if (resolution === "confirmed") await setPartnerStatus(programId, [f.partnerId], "banned", ctx.actor);
      else {
        // only holds the fraud checks placed; a hold someone added by hand stays
        const held = await db()
          .select({ id: commission.id })
          .from(commission)
          .where(
            and(
              eq(commission.partnerId, f.partnerId),
              eq(commission.status, "held"),
              sql`(${commission.heldReason} like 'Auto-held%' or ${commission.heldReason} like 'Risk%' or ${commission.heldReason} = 'Sub-partner commission held')`,
            ),
          );
        if (held.length)
          await releaseCommissions(
            programId,
            held.map((h) => h.id),
            ctx.actor,
          );
        // the score drops to the worst flag still open
        const [open] = await db()
          .select({ n: sql<number>`coalesce(max(${fraudFlag.score}), 0)::int` })
          .from(fraudFlag)
          .where(and(eq(fraudFlag.partnerId, f.partnerId), eq(fraudFlag.resolution, "open")));
        await db()
          .update(partner)
          .set({ riskScore: open?.n ?? 0 })
          .where(eq(partner.id, f.partnerId));
      }
      await audit(ctx.program.workspaceId, ctx.actor, `fraud.${resolution}`, {
        type: "fraud_flag",
        id: flagId,
      });
      rv(programId);
      return true;
    },
    resolution === "confirmed"
      ? "Partner banned and commissions held"
      : "Flag dismissed and commissions released",
  );
}

/* ------------------------------------------------------------------ assistant */

export async function askAction(programId: string, question: string) {
  return safe(async () => {
    const ctx = await actionCtx(programId, "read");
    return ask(programId, z.string().min(2).max(500).parse(question), {
      base: `/app/${programId}`,
      currency: ctx.program.currency,
      workspaceId: ctx.program.workspaceId,
    });
  });
}
