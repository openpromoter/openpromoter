import { agentAction, campaign, commission, partner, partnerGroup, payout, program } from "@openpromoter/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { createId } from "@/lib/id";
import { formatMoney, formatPercent } from "@/lib/money";
import { delta, idlePartners, overview, pendingApplications, previous, topPartners } from "../analytics";
import { type Actor, audit } from "../audit";
import { type CampaignDraft, createCampaign } from "../campaigns";
import { db } from "../db";
import { enqueue } from "../jobs";
import { payableBalances } from "../ledger";
import { sendMessage, setPartnerStatus } from "../partners";
import { cancelPayout, createPayoutBatch } from "../payouts";
import { aiText } from "./provider";

type Program = typeof program.$inferSelect;
type Action = typeof agentAction.$inferSelect;

export type ActionKind =
  | "message_idle"
  | "promote_tier"
  | "pause_partner"
  | "propose_campaign"
  | "approve_application"
  | "prepare_payouts";

/** Kinds Autopilot may apply by itself in "act" mode. Money never moves without a human. */
export const SAFE_KINDS: ActionKind[] = [
  "message_idle",
  "promote_tier",
  "pause_partner",
  "approve_application",
];

interface Suggestion {
  kind: ActionKind;
  title: string;
  detail: string;
  targetType?: string;
  targetId?: string;
  payload: Record<string, unknown>;
  impact?: number;
}

async function reactivationMessage(prog: Program, count: number) {
  const pct =
    prog.commissionType === "percent"
      ? `${prog.commissionValue / 100}%`
      : formatMoney(prog.commissionValue, prog.currency);
  const fallback = `Hi from ${prog.name}. You still earn ${pct} on every customer you refer. The content kit in your portal has new posts and copy you can use today. Reply to this message if anything would make promoting us easier.`;
  const ai = await aiText({
    system:
      "Write the body of a short, warm note (max 70 words) from a SaaS founder to affiliate partners who have gone quiet. Write only the body, without a subject line. Keep every sentence under 16 words. Give one clear call to action. Mention only the facts given. Never say anything is new or has changed. No emojis and no hype.",
    prompt: `Product: ${prog.name} (${prog.websiteUrl}). Commission: ${pct} on every customer they refer. Partners going quiet: ${count}. Their partner portal has a content kit with ready-made posts, emails and banners.`,
    workspaceId: prog.workspaceId,
  });
  return ai?.trim() || fallback;
}

/** Look at the program and produce suggestions. Pure reads; storing happens in runAutopilot. */
export async function suggest(prog: Program, now = new Date()): Promise<Suggestion[]> {
  const out: Suggestion[] = [];
  const range = { from: new Date(now.getTime() - 30 * 86_400_000), to: now };

  const idle = await idlePartners(prog.id, 30);
  if (idle.length > 0) {
    out.push({
      kind: "message_idle",
      title: `Re-engage ${idle.length} quiet partner${idle.length === 1 ? "" : "s"}`,
      detail: `${idle.length} approved partners sent no clicks in 30 days. Autopilot drafted a short note pointing them to the content kit.`,
      payload: {
        partnerIds: idle.map((p) => p.id),
        subject: `New content to share for ${prog.name}`,
        body: await reactivationMessage(prog, idle.length),
      },
    });
  }

  const groups = await db()
    .select()
    .from(partnerGroup)
    .where(eq(partnerGroup.programId, prog.id))
    .orderBy(partnerGroup.rank);
  const top = (await topPartners(prog.id, range, 5)).filter((p) => p.revenue > 0 && p.status === "approved");
  const highest = groups[groups.length - 1];
  if (highest) {
    const members = await db()
      .select({ id: partner.id, groupId: partner.groupId })
      .from(partner)
      .where(inArray(partner.id, top.map((t) => t.id).concat("none")));
    for (const t of top.slice(0, 3)) {
      const m = members.find((x) => x.id === t.id);
      const cur = groups.find((g) => g.id === m?.groupId);
      const next = groups.find((g) => g.rank === (cur?.rank ?? -1) + 1);
      if (next && (!cur || cur.rank < highest.rank)) {
        out.push({
          kind: "promote_tier",
          title: `Move ${t.name} to ${next.name}`,
          detail: `${t.name} referred ${formatMoney(t.revenue, prog.currency)} in the last 30 days and is one of your top partners. A higher tier keeps them motivated.`,
          targetType: "partner",
          targetId: t.id,
          payload: { partnerId: t.id, toGroupId: next.id, fromGroupId: cur?.id ?? null },
          impact: t.revenue,
        });
      }
    }
  }

  const risky = await db()
    .select()
    .from(partner)
    .where(
      and(
        eq(partner.programId, prog.id),
        eq(partner.status, "approved"),
        gte(partner.riskScore, prog.fraudHoldScore),
      ),
    );
  for (const r of risky.slice(0, 5)) {
    out.push({
      kind: "pause_partner",
      title: `Pause ${r.name} (risk ${r.riskScore})`,
      detail: `Fraud checks scored this partner ${r.riskScore}/100. Pausing stops new commissions and holds unpaid ones until you review.`,
      targetType: "partner",
      targetId: r.id,
      payload: { partnerId: r.id, prevStatus: r.status },
    });
  }

  const cur = await overview(prog.id, range);
  const prev = await overview(prog.id, previous(range));
  const liveCampaigns = await db()
    .select({ id: campaign.id })
    .from(campaign)
    .where(and(eq(campaign.programId, prog.id), eq(campaign.status, "active")));
  if (liveCampaigns.length === 0 && (cur.customers < prev.customers || cur.clicks < prev.clicks * 0.8)) {
    const draft: CampaignDraft = {
      name: "1.5x commissions for 14 days",
      description:
        "Autopilot: activity dropped versus the previous 30 days. A short boost usually brings partners back.",
      rule: { kind: "boost", multiplier: 1.5 },
      startsAt: now,
      endsAt: new Date(now.getTime() + 14 * 86_400_000),
    };
    out.push({
      kind: "propose_campaign",
      title: "Run a 14-day 1.5x commission boost",
      detail: `Customers ${cur.customers} vs ${prev.customers} and clicks ${cur.clicks} vs ${prev.clicks} (${formatPercent(delta(cur.clicks, prev.clicks))}) compared with the previous 30 days.`,
      payload: {
        draft: { ...draft, startsAt: draft.startsAt.toISOString(), endsAt: draft.endsAt?.toISOString() },
      },
    });
  }

  const waiting = (await pendingApplications(prog.id)).filter(
    (p) => now.getTime() - p.createdAt.getTime() > 2 * 86_400_000,
  );
  for (const w of waiting.slice(0, 10)) {
    if (w.riskScore < 20) {
      out.push({
        kind: "approve_application",
        title: `Approve ${w.name}`,
        detail: `Waiting ${Math.round((now.getTime() - w.createdAt.getTime()) / 86_400_000)} days with a low risk score (${w.riskScore}). Fast approvals keep new partners interested.`,
        targetType: "partner",
        targetId: w.id,
        payload: { partnerId: w.id },
      });
    }
  }

  const owed = await payableBalances(prog.id);
  if (owed.length > 0) {
    const total = owed.reduce((a, b) => a + b.approved, 0);
    out.push({
      kind: "prepare_payouts",
      title: `Prepare payouts for ${owed.length} partner${owed.length === 1 ? "" : "s"}`,
      detail: `${formatMoney(total, owed[0]!.currency)} is approved and past the hold period. Autopilot can prepare the batch; you approve it before any money moves.`,
      payload: { partnerIds: owed.map((o) => o.partnerId) },
      impact: total,
    });
  }
  return out;
}

export async function runAutopilot(programId: string, now = new Date()) {
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  if (!prog?.autopilotEnabled) return { created: 0, applied: 0 };
  const runId = createId("run");
  const recent = await db()
    .select()
    .from(agentAction)
    .where(
      and(
        eq(agentAction.programId, programId),
        gte(agentAction.createdAt, new Date(now.getTime() - 6 * 86_400_000)),
      ),
    );
  let created = 0;
  let applied = 0;
  for (const s of await suggest(prog, now)) {
    if (recent.some((r) => r.kind === s.kind && (r.targetId ?? null) === (s.targetId ?? null))) continue;
    const [a] = await db()
      .insert(agentAction)
      .values({
        id: createId("act"),
        programId,
        source: "autopilot",
        kind: s.kind,
        title: s.title,
        detail: s.detail,
        targetType: s.targetType,
        targetId: s.targetId,
        payload: s.payload,
        impact: s.impact,
        runId,
      })
      .returning();
    created++;
    if (prog.autopilotMode === "act" && SAFE_KINDS.includes(s.kind)) {
      await applyAction(programId, a!.id, { type: "ai", id: runId });
      applied++;
    }
  }
  await enqueue("events.emit", {
    workspaceId: prog.workspaceId,
    event: "autopilot.action",
    data: { runId, created, applied, title: `Autopilot: ${created} suggestions and ${applied} applied` },
  });
  return { created, applied, runId };
}

/** Apply a suggestion. Stores what is needed to undo it. */
export async function applyAction(programId: string, actionId: string, actor: Actor): Promise<Action> {
  const [a] = await db()
    .select()
    .from(agentAction)
    .where(and(eq(agentAction.id, actionId), eq(agentAction.programId, programId)));
  if (!a) throw new Error("Action not found");
  if (a.status !== "suggested") throw new Error(`Action is already ${a.status}`);
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  if (!prog) throw new Error("Program not found");
  const p = a.payload as Record<string, any>;
  let undo: Record<string, unknown> = {};

  switch (a.kind as ActionKind) {
    case "message_idle": {
      const ids: string[] = [];
      for (const partnerId of p.partnerIds as string[])
        ids.push((await sendMessage(prog, { partnerId, subject: p.subject, body: p.body })).id);
      undo = { messageIds: ids };
      break;
    }
    case "promote_tier":
      await db()
        .update(partner)
        .set({ groupId: p.toGroupId })
        .where(and(eq(partner.id, p.partnerId), eq(partner.programId, programId)));
      undo = { partnerId: p.partnerId, groupId: p.fromGroupId };
      break;
    case "pause_partner": {
      await setPartnerStatus(programId, [p.partnerId], "paused", actor);
      const held = await db()
        .update(commission)
        .set({ status: "held", heldReason: "Paused by Autopilot for review" })
        .where(
          and(
            eq(commission.partnerId, p.partnerId),
            inArray(commission.status, ["pending", "approved"]),
            sql`${commission.payoutId} is null`,
          ),
        )
        .returning({ id: commission.id, status: commission.status });
      undo = { partnerId: p.partnerId, prevStatus: p.prevStatus, heldIds: held.map((h) => h.id) };
      break;
    }
    case "propose_campaign": {
      const d = p.draft as Record<string, any>;
      const c = await createCampaign(
        programId,
        { ...d, startsAt: new Date(), endsAt: d.endsAt ? new Date(d.endsAt) : null } as CampaignDraft,
        actor,
      );
      undo = { campaignId: c.id };
      break;
    }
    case "approve_application":
      await setPartnerStatus(programId, [p.partnerId], "approved", actor);
      undo = { partnerId: p.partnerId, prevStatus: "pending" };
      break;
    case "prepare_payouts": {
      const batch = await createPayoutBatch(programId, actor, p.partnerIds);
      undo = { payoutIds: batch.map((b) => b.id) };
      break;
    }
  }
  const [updated] = await db()
    .update(agentAction)
    .set({ status: "applied", appliedAt: new Date(), undo })
    .where(eq(agentAction.id, a.id))
    .returning();
  await audit(
    prog.workspaceId,
    actor,
    "agent_action.apply",
    { type: "agent_action", id: a.id },
    { kind: a.kind },
  );
  return updated!;
}

export async function undoAction(programId: string, actionId: string, actor: Actor): Promise<Action> {
  const [a] = await db()
    .select()
    .from(agentAction)
    .where(and(eq(agentAction.id, actionId), eq(agentAction.programId, programId)));
  if (a?.status !== "applied") throw new Error("Only applied actions can be undone");
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  const u = (a.undo ?? {}) as Record<string, any>;
  const { message } = await import("@openpromoter/db");
  switch (a.kind as ActionKind) {
    case "message_idle":
      // emails that already went out can't be recalled; the portal messages are removed
      if (u.messageIds?.length) await db().delete(message).where(inArray(message.id, u.messageIds));
      break;
    case "promote_tier":
      await db().update(partner).set({ groupId: u.groupId }).where(eq(partner.id, u.partnerId));
      break;
    case "pause_partner":
      await db().update(partner).set({ status: u.prevStatus }).where(eq(partner.id, u.partnerId));
      if (u.heldIds?.length) {
        await db()
          .update(commission)
          .set({
            status: sql`case when ${commission.holdUntil} is null or ${commission.holdUntil} <= now() then 'approved' else 'pending' end`,
            heldReason: null,
          })
          .where(and(inArray(commission.id, u.heldIds), eq(commission.status, "held")));
      }
      break;
    case "propose_campaign":
      await db()
        .update(campaign)
        .set({ status: "ended", endsAt: new Date() })
        .where(eq(campaign.id, u.campaignId));
      break;
    case "approve_application":
      await db()
        .update(partner)
        .set({ status: "pending", approvedAt: null })
        .where(eq(partner.id, u.partnerId));
      break;
    case "prepare_payouts":
      for (const id of (u.payoutIds as string[]) ?? []) await cancelPayout(programId, id, actor);
      break;
  }
  const [updated] = await db()
    .update(agentAction)
    .set({ status: "undone" })
    .where(eq(agentAction.id, a.id))
    .returning();
  if (prog)
    await audit(
      prog.workspaceId,
      actor,
      "agent_action.undo",
      { type: "agent_action", id: a.id },
      { kind: a.kind },
    );
  return updated!;
}

export async function dismissAction(programId: string, actionId: string) {
  await db()
    .update(agentAction)
    .set({ status: "dismissed" })
    .where(
      and(
        eq(agentAction.id, actionId),
        eq(agentAction.programId, programId),
        eq(agentAction.status, "suggested"),
      ),
    );
}

export const recentActions = (programId: string, limit = 50) =>
  db()
    .select()
    .from(agentAction)
    .where(eq(agentAction.programId, programId))
    .orderBy(desc(agentAction.createdAt))
    .limit(limit);

export const openPayouts = (programId: string) =>
  db()
    .select()
    .from(payout)
    .where(and(eq(payout.programId, programId), eq(payout.status, "awaiting_approval")));
