import {
  bountySubmission,
  type CampaignRule,
  campaign,
  click,
  commission,
  partner,
  partnerGroup,
  program,
  referral,
} from "@openpromoter/db";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@/lib/id";
import { toMinor } from "@/lib/money";
import { aiJson } from "./ai/provider";
import { type Actor, audit } from "./audit";
import { isCampaignLive } from "./commission";
import { db } from "./db";

export interface CampaignDraft {
  name: string;
  description: string;
  rule: CampaignRule;
  startsAt: Date;
  endsAt: Date | null;
}

const WORD_NUM: Record<string, number> = { double: 2, twice: 2, triple: 3, quadruple: 4 };

function endOf(unit: "week" | "month", now: Date) {
  const d = new Date(now);
  if (unit === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const day = d.getUTCDay();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (7 - day)));
}

/** Rule-based parser: covers the common phrasings without AI. */
export function parseCampaign(text: string, now = new Date(), currency = "usd"): CampaignDraft | null {
  const t = text.toLowerCase();
  let endsAt: Date | null = null;
  const forDays = t.match(/for (\d+) (day|week)s?/);
  if (forDays)
    endsAt = new Date(now.getTime() + Number(forDays[1]) * (forDays[2] === "week" ? 7 : 1) * 86_400_000);
  else if (/this month|in \w+ only|until the end of the month/.test(t)) endsAt = endOf("month", now);
  else if (/this week/.test(t)) endsAt = endOf("week", now);
  else if (/next (\d+) days/.test(t))
    endsAt = new Date(now.getTime() + Number(t.match(/next (\d+) days/)![1]) * 86_400_000);
  const until = t.match(/until ([a-z]+ \d{1,2}(?:,? \d{4})?|\d{4}-\d{2}-\d{2})/);
  if (until) {
    const d = new Date(/\d{4}/.test(until[1]!) ? until[1]! : `${until[1]} ${now.getUTCFullYear()}`);
    if (!Number.isNaN(d.getTime())) endsAt = d;
  }
  const intervals = /annual|yearly|year/.test(t)
    ? ["year"]
    : /monthly plan|monthly plans/.test(t)
      ? ["month"]
      : undefined;
  const money = t.match(/\$\s?(\d+(?:\.\d+)?)/);

  // contest
  if (/contest|leaderboard|top \d+|prize/.test(t)) {
    const prizes = [...t.matchAll(/\$\s?(\d+(?:\.\d+)?)/g)].map((m) => toMinor(m[1]!, currency));
    const metric = /click/.test(t) ? "clicks" : /referral|signup|customer/.test(t) ? "referrals" : "revenue";
    return {
      name: `${metric === "revenue" ? "Revenue" : metric === "clicks" ? "Clicks" : "Referrals"} contest`,
      description: text,
      rule: {
        kind: "contest",
        metric,
        prizes: prizes.length
          ? prizes
          : [toMinor(500, currency), toMinor(250, currency), toMinor(100, currency)],
      },
      startsAt: now,
      endsAt: endsAt ?? endOf("month", now),
    };
  }

  // bounty
  if (
    money &&
    /per ([a-z]+ )?(signup|sign-up|sign up|lead|post|video|review|tweet|article)|bounty|for every|when (they|a partner) (reach|hit)|first (sale|customer)/.test(
      t,
    )
  ) {
    const reward = toMinor(money[1]!, currency);
    const trigger = /post|video|review|tweet|article/.test(t)
      ? "post"
      : /signup|sign-up|sign up|lead/.test(t)
        ? "signup"
        : /reach|hit|milestone/.test(t)
          ? "revenue_milestone"
          : "first_sale";
    const ms =
      trigger === "revenue_milestone"
        ? [...t.matchAll(/\$\s?(\d+(?:\.\d+)?)(k)?/g)].map((m) =>
            toMinor(Number(m[1]) * (m[2] ? 1000 : 1), currency),
          )
        : [];
    const label = {
      post: "Content bounty",
      signup: "Signup bounty",
      revenue_milestone: "Milestone bounty",
      first_sale: "First sale bounty",
    }[trigger];
    return {
      name: label,
      description: text,
      rule: {
        kind: "bounty",
        trigger,
        reward: trigger === "revenue_milestone" ? (ms[0] ?? reward) : reward,
        milestone: trigger === "revenue_milestone" ? (ms[1] ?? ms[0]) : undefined,
      },
      startsAt: now,
      endsAt,
    };
  }

  // boost
  const word = Object.keys(WORD_NUM).find((w) => t.includes(w));
  const mult = word
    ? WORD_NUM[word]!
    : (() => {
        const m = t.match(/(\d+(?:\.\d+)?)\s?x/);
        if (m) return Number(m[1]);
        const pct = t.match(/\+?(\d+)%\s*(more|extra|bonus|boost)/);
        return pct ? 1 + Number(pct[1]) / 100 : null;
      })();
  if (mult && mult > 5) throw new Error("Boosts can't go above 5x commissions");
  if (mult && mult > 1) {
    return {
      name: `${mult}x commissions${intervals ? ` on ${intervals[0] === "year" ? "annual" : "monthly"} plans` : ""}`,
      description: text,
      rule: { kind: "boost", multiplier: mult, intervals },
      startsAt: now,
      endsAt: endsAt ?? endOf("month", now),
    };
  }
  return null;
}

const aiSchema = z.object({
  name: z.string(),
  kind: z.enum(["boost", "bounty", "contest"]),
  multiplier: z.number(),
  intervals: z.array(z.enum(["month", "year"])),
  trigger: z.enum(["signup", "first_sale", "revenue_milestone", "post", "none"]),
  rewardMajor: z.number(),
  milestoneMajor: z.number(),
  prizesMajor: z.array(z.number()),
  metric: z.enum(["revenue", "referrals", "clicks"]),
  startInDays: z.number().int(),
  durationDays: z.number().int(),
});

export async function draftCampaign(
  text: string,
  currency = "usd",
  now = new Date(),
  workspaceId?: string,
): Promise<CampaignDraft | null> {
  const ai = await aiJson(aiSchema, {
    system:
      "Turn a founder's one-sentence request into an affiliate campaign. kind=boost multiplies commissions (multiplier, optional plan intervals). kind=bounty pays a fixed reward on a trigger. kind=contest ranks partners by metric and pays prizes. Use 0 / empty arrays / 'none' for fields that don't apply. startInDays is how many days from today the campaign starts (0 = today); for a named event such as Black Friday or a launch date, start on that day. durationDays counts from the start (0 = until the end of that month).",
    prompt: `Today is ${now.toISOString().slice(0, 10)}. Currency ${currency}. Request: "${text}"`,
    workspaceId,
  });
  if (!ai) return parseCampaign(text, now, currency);
  // a future start is fine: boosts and bounties only count from startsAt (commission.ts)
  const startsAt =
    ai.startInDays > 0 ? new Date(now.getTime() + Math.min(ai.startInDays, 365) * 86_400_000) : now;
  const endsAt =
    ai.durationDays > 0
      ? new Date(startsAt.getTime() + ai.durationDays * 86_400_000)
      : endOf("month", startsAt);
  const rule: CampaignRule =
    ai.kind === "boost"
      ? {
          kind: "boost",
          multiplier: Math.min(5, Math.max(1.1, ai.multiplier)),
          intervals: ai.intervals.length ? ai.intervals : undefined,
        }
      : ai.kind === "bounty"
        ? {
            kind: "bounty",
            trigger: ai.trigger === "none" ? "first_sale" : ai.trigger,
            reward: toMinor(ai.rewardMajor, currency),
            milestone: ai.milestoneMajor ? toMinor(ai.milestoneMajor, currency) : undefined,
          }
        : { kind: "contest", metric: ai.metric, prizes: ai.prizesMajor.map((p) => toMinor(p, currency)) };
  return {
    name: ai.name,
    description: text,
    rule,
    startsAt,
    endsAt: ai.kind === "bounty" && ai.durationDays === 0 ? null : endsAt,
  };
}

export async function createCampaign(
  programId: string,
  draft: CampaignDraft,
  actor: Actor,
  status: "draft" | "active" = "active",
) {
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  if (!prog) throw new Error("Program not found");
  // the rule comes from the browser, the API or the AI: check it here, where every path meets
  const MONEY = z.number().int().min(1).max(100_000_000);
  draft = {
    ...draft,
    rule: z
      .object({
        kind: z.enum(["boost", "bounty", "contest"]),
        multiplier: z
          .number()
          .gt(1, "A boost must raise the commission")
          .max(5, "Boosts go up to 5x")
          .optional(),
        intervals: z
          .array(z.enum(["month", "year", "week", "day"]))
          .max(4)
          .optional(),
        trigger: z.enum(["signup", "first_sale", "revenue_milestone", "post"]).optional(),
        reward: MONEY.optional(),
        milestone: MONEY.optional(),
        prizes: z.array(MONEY).min(1).max(10).optional(),
        metric: z.enum(["revenue", "referrals", "clicks"]).optional(),
        groupIds: z.array(z.string()).max(50).optional(),
      })
      .refine((r) => r.kind !== "boost" || r.multiplier, "A boost needs a multiplier")
      .refine((r) => r.kind !== "bounty" || (r.trigger && r.reward), "A bounty needs a trigger and a reward")
      .refine((r) => r.kind !== "contest" || r.prizes, "A contest needs prizes")
      .parse(draft.rule) as CampaignDraft["rule"],
  };
  const [c] = await db()
    .insert(campaign)
    .values({
      id: createId("cmp"),
      programId,
      name: draft.name,
      description: draft.description,
      rule: draft.rule,
      status,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      prompt: draft.description,
    })
    .returning();
  await audit(
    prog.workspaceId,
    actor,
    "campaign.create",
    { type: "campaign", id: c!.id },
    { rule: draft.rule },
  );
  return c!;
}

async function grant(
  prog: typeof program.$inferSelect,
  partnerId: string,
  c: typeof campaign.$inferSelect,
  amount: number,
  key: string,
  description: string,
  held = false,
) {
  await db()
    .insert(commission)
    .values({
      id: createId("com"),
      programId: prog.id,
      workspaceId: prog.workspaceId,
      partnerId,
      kind: "bounty",
      sourceKey: key,
      amount,
      currency: prog.currency,
      status: held ? "held" : "pending",
      heldReason: held
        ? "Signup reported by the browser script. Approve it once you know the signup is real."
        : null,
      holdUntil: new Date(Date.now() + prog.holdDays * 86_400_000),
      campaignId: c.id,
      description,
    })
    .onConflictDoNothing();
}

/** Called after signups and sales: pays any bounty the partner just earned. Idempotent via sourceKey. */
export async function evaluateBounties(programId: string, partnerId: string, trigger: string, held = false) {
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  const [p] = await db().select().from(partner).where(eq(partner.id, partnerId));
  if (!prog || !p || p.status !== "approved") return 0;
  const now = new Date();
  const live = (
    await db()
      .select()
      .from(campaign)
      .where(and(eq(campaign.programId, programId), eq(campaign.status, "active")))
  ).filter(
    (c) =>
      c.rule.kind === "bounty" &&
      isCampaignLive(c, now) &&
      (!c.rule.groupIds?.length || (p.groupId && c.rule.groupIds.includes(p.groupId))),
  );
  let granted = 0;
  for (const c of live) {
    const r = c.rule;
    if (r.trigger === "signup" && trigger === "signup") {
      const [last] = await db()
        .select()
        .from(referral)
        .where(eq(referral.partnerId, partnerId))
        .orderBy(desc(referral.createdAt))
        .limit(1);
      if (last && last.createdAt >= c.startsAt) {
        await grant(
          prog,
          partnerId,
          c,
          r.reward ?? 0,
          `bounty:${c.id}:${last.id}`,
          `${c.name}: new signup`,
          held,
        );
        granted++;
      }
    }
    if (r.trigger === "first_sale" && trigger === "first_sale") {
      await grant(
        prog,
        partnerId,
        c,
        r.reward ?? 0,
        `bounty:${c.id}:${partnerId}`,
        `${c.name}: first paying customer`,
      );
      granted++;
    }
    if (r.trigger === "revenue_milestone" && r.milestone) {
      const [row] = await db()
        .select({ rev: sql<number>`coalesce(sum(${commission.saleAmount}),0)::int` })
        .from(commission)
        .where(and(eq(commission.partnerId, partnerId), gte(commission.createdAt, c.startsAt)));
      if ((row?.rev ?? 0) >= r.milestone) {
        await grant(
          prog,
          partnerId,
          c,
          r.reward ?? 0,
          `bounty:${c.id}:${partnerId}`,
          `${c.name}: reached the revenue milestone`,
        );
        granted++;
      }
    }
  }
  return granted;
}

export async function reviewSubmission(
  programId: string,
  submissionId: string,
  approve: boolean,
  actor: Actor,
) {
  const [row] = await db()
    .select({ s: bountySubmission, c: campaign })
    .from(bountySubmission)
    .innerJoin(campaign, eq(campaign.id, bountySubmission.campaignId))
    .where(and(eq(bountySubmission.id, submissionId), eq(campaign.programId, programId)));
  if (row?.s.status !== "pending") return false;
  await db()
    .update(bountySubmission)
    .set({ status: approve ? "approved" : "rejected" })
    .where(eq(bountySubmission.id, submissionId));
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  if (approve && prog)
    await grant(
      prog,
      row.s.partnerId,
      row.c,
      row.c.rule.reward ?? 0,
      `bounty:${row.c.id}:${row.s.id}`,
      `${row.c.name}: ${row.s.url}`,
    );
  if (prog)
    await audit(prog.workspaceId, actor, approve ? "bounty.approve" : "bounty.reject", {
      type: "bounty_submission",
      id: submissionId,
    });
  return true;
}

/** Contest standings by metric over the campaign window. */
export async function contestStandings(c: typeof campaign.$inferSelect, limit = 20) {
  const end = c.endsAt ?? new Date();
  const metric = c.rule.metric ?? "revenue";
  if (metric === "clicks") {
    return db()
      .select({ partnerId: click.partnerId, name: partner.name, value: sql<number>`count(*)::int` })
      .from(click)
      .innerJoin(partner, eq(partner.id, click.partnerId))
      .where(
        and(
          eq(click.programId, c.programId),
          gte(click.createdAt, c.startsAt),
          lt(click.createdAt, end),
          eq(click.isBot, false),
        ),
      )
      .groupBy(click.partnerId, partner.name)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);
  }
  if (metric === "referrals") {
    return db()
      .select({ partnerId: referral.partnerId, name: partner.name, value: sql<number>`count(*)::int` })
      .from(referral)
      .innerJoin(partner, eq(partner.id, referral.partnerId))
      .where(
        and(
          eq(referral.programId, c.programId),
          gte(referral.createdAt, c.startsAt),
          lt(referral.createdAt, end),
        ),
      )
      .groupBy(referral.partnerId, partner.name)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);
  }
  return db()
    .select({
      partnerId: commission.partnerId,
      name: partner.name,
      value: sql<number>`coalesce(sum(${commission.saleAmount}),0)::int`,
    })
    .from(commission)
    .innerJoin(partner, eq(partner.id, commission.partnerId))
    .where(
      and(
        eq(commission.programId, c.programId),
        gte(commission.createdAt, c.startsAt),
        lt(commission.createdAt, end),
        inArray(commission.kind, ["sale", "adjustment"]),
      ),
    )
    .groupBy(commission.partnerId, partner.name)
    .orderBy(desc(sql`sum(${commission.saleAmount})`))
    .limit(limit);
}

/** Ends campaigns past their end date and pays contest prizes (as pending commissions, through the normal hold). */
export async function settleEndedCampaigns(now = new Date()) {
  const ended = await db()
    .select()
    .from(campaign)
    .where(and(eq(campaign.status, "active"), lt(campaign.endsAt, now)));
  for (const c of ended) {
    const [prog] = await db().select().from(program).where(eq(program.id, c.programId));
    if (prog && c.rule.kind === "contest" && !c.settledAt) {
      const standings = (await contestStandings(c, c.rule.prizes?.length ?? 3)).filter((s) => s.value > 0);
      for (const [i, s] of standings.entries()) {
        const prize = c.rule.prizes?.[i];
        if (prize)
          await grant(prog, s.partnerId, c, prize, `contest:${c.id}:${i}`, `${c.name}: place ${i + 1}`);
      }
    }
    await db().update(campaign).set({ status: "ended", settledAt: now }).where(eq(campaign.id, c.id));
  }
  return ended.length;
}

/** Auto-promote partners into higher tiers when their referred revenue crosses the tier threshold. */
export async function evaluateTiers(programId: string, partnerId: string) {
  const [p] = await db().select().from(partner).where(eq(partner.id, partnerId));
  if (!p) return null;
  const groups = await db().select().from(partnerGroup).where(eq(partnerGroup.programId, programId));
  const [row] = await db()
    .select({ rev: sql<number>`coalesce(sum(${commission.saleAmount}),0)::int` })
    .from(commission)
    .where(eq(commission.partnerId, partnerId));
  const rev = row?.rev ?? 0;
  const current = groups.find((g) => g.id === p.groupId);
  const target = groups
    .filter((g) => g.promoteAtRevenue != null && rev >= g.promoteAtRevenue)
    .sort((a, b) => b.rank - a.rank)[0];
  if (target && (!current || target.rank > current.rank)) {
    await db().update(partner).set({ groupId: target.id }).where(eq(partner.id, partnerId));
    return target;
  }
  return null;
}
