import { click, commission, fraudFlag, partner, program, referral } from "@openpromoter/db";
import { and, desc, eq, gte, inArray, isNull, like, or, sql } from "drizzle-orm";
import { createId } from "@/lib/id";
import { db } from "./db";
import { combineScores, scorePartner, selfRecruited } from "./fraud";
import { enqueue } from "./jobs";

/** Re-score one partner from their last 90 days, store flags, and auto-hold above the program threshold. */
export async function rescorePartner(partnerId: string) {
  const [row] = await db()
    .select({ p: partner, prog: program })
    .from(partner)
    .innerJoin(program, eq(program.id, partner.programId))
    .where(eq(partner.id, partnerId));
  if (!row) return null;
  const { p, prog } = row;
  const since = new Date(Date.now() - 90 * 86_400_000);
  const refs = await db()
    .select()
    .from(referral)
    .where(and(eq(referral.partnerId, p.id), gte(referral.createdAt, since)))
    .orderBy(desc(referral.createdAt))
    .limit(5000);
  const clicks = await db()
    .select({
      visitorId: click.visitorId,
      ipHash: click.ipHash,
      userAgent: click.userAgent,
      landingUrl: click.landingUrl,
      referrer: click.referrer,
      utm: click.utm,
      isBot: click.isBot,
    })
    .from(click)
    .where(and(eq(click.partnerId, p.id), gte(click.createdAt, since)))
    .orderBy(desc(click.createdAt))
    .limit(5000);
  const [paid] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(commission)
    .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "sale"), eq(commission.status, "paid")));
  const [clawed] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(commission)
    .where(
      and(
        eq(commission.partnerId, p.id),
        like(commission.sourceKey, "refund:%"),
        like(commission.description, "%clawback%"),
      ),
    );

  const result = scorePartner({
    partnerEmail: p.email,
    partnerSignupIpHash: p.signupIpHash,
    referrals: refs,
    clicks,
    paidCommissions: paid?.n ?? 0,
    refundedAfterPayout: clawed?.n ?? 0,
  });

  // the same PayPal/Wise account on two partners usually means one person running several accounts
  const shared = [p.paypalEmail, p.wiseEmail].filter((x): x is string => !!x);
  if (shared.length) {
    const [dupe] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(partner)
      .where(
        and(
          eq(partner.programId, prog.id),
          sql`${partner.id} <> ${p.id}`,
          or(
            inArray(
              sql`lower(${partner.paypalEmail})`,
              shared.map((x) => x.toLowerCase()),
            ),
            inArray(
              sql`lower(${partner.wiseEmail})`,
              shared.map((x) => x.toLowerCase()),
            ),
          ),
        ),
      );
    if ((dupe?.n ?? 0) > 0) {
      result.signals.push({
        kind: "duplicate_payout_method",
        score: 70,
        detail: `This partner's payout account is also used by ${dupe!.n} other partner${dupe!.n === 1 ? "" : "s"}.`,
      });
      result.score = combineScores(result.signals.map((x) => x.score));
    }
  }

  // two-tier: a recruiter whose sub-partners look like their own second accounts
  const subs = await db()
    .select()
    .from(partner)
    .where(and(eq(partner.programId, prog.id), eq(partner.recruitedBy, p.id)))
    .limit(5000);
  const selfSubs = subs.filter((s) => selfRecruited(p, s));
  if (selfSubs.length) {
    result.signals.push({
      kind: "self_recruit",
      score: 90,
      detail: `${selfSubs.length} recruited partner${selfSubs.length === 1 ? " looks" : "s look"} like this partner's own account.`,
    });
    result.score = combineScores(result.signals.map((x) => x.score));
  }

  for (const s of result.signals) {
    await db()
      .insert(fraudFlag)
      .values({
        id: createId("frd"),
        programId: prog.id,
        partnerId: p.id,
        referralId: s.referralId ?? "",
        signal: s.kind,
        score: s.score,
        detail: s.detail,
      })
      .onConflictDoUpdate({
        target: [fraudFlag.partnerId, fraudFlag.signal, fraudFlag.referralId],
        set: { score: s.score, detail: s.detail },
      });
  }
  await db().update(partner).set({ riskScore: result.score }).where(eq(partner.id, p.id));

  if (result.score >= prog.fraudHoldScore) {
    const held = await db()
      .update(commission)
      .set({ status: "held", heldReason: `Auto-held: risk score ${result.score}` })
      .where(
        and(
          eq(commission.partnerId, p.id),
          inArray(commission.status, ["pending", "approved"]),
          isNull(commission.payoutId),
        ),
      )
      .returning({ id: commission.id });
    // overrides earned on this partner's held commissions wait with them
    if (held.length)
      await db()
        .update(commission)
        .set({ status: "held", heldReason: "Sub-partner commission held" })
        .where(
          and(
            inArray(
              commission.parentId,
              held.map((h) => h.id),
            ),
            inArray(commission.status, ["pending", "approved"]),
            isNull(commission.payoutId),
          ),
        );
    if (p.riskScore < prog.fraudHoldScore) {
      await enqueue("events.emit", {
        workspaceId: prog.workspaceId,
        event: "fraud.flagged",
        data: {
          partnerId: p.id,
          name: p.name,
          score: result.score,
          held: held.length,
          detail: result.signals.map((s) => s.detail).join(" "),
        },
      });
    }
  }
  return result;
}

export async function rescoreProgram(programId: string) {
  const ids = await db()
    .select({ id: partner.id })
    .from(partner)
    .where(and(eq(partner.programId, programId), inArray(partner.status, ["approved", "paused"])));
  for (const { id } of ids) await rescorePartner(id);
  return ids.length;
}

/** Daily rescoring: one job per 200 partners, so a program with 10k partners never blocks a worker for long. */
export async function enqueueProgramRescore(programId: string) {
  const ids = await db()
    .select({ id: partner.id })
    .from(partner)
    .where(and(eq(partner.programId, programId), inArray(partner.status, ["approved", "paused"])));
  for (let i = 0; i < ids.length; i += 200)
    await enqueue("fraud.rescore_batch", { partnerIds: ids.slice(i, i + 200).map((x) => x.id) });
  return ids.length;
}
