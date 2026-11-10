import {
  campaign,
  chargeLink,
  click,
  commission,
  fraudFlag,
  parkedPayment,
  partner,
  partnerGroup,
  processedEvent,
  program,
  promoCode,
  referral,
} from "@openpromoter/db";
import { and, desc, eq, gte, inArray, isNull, like, lt, sql } from "drizzle-orm";
import { createId } from "@/lib/id";
import { ATTRIBUTION_ORDER, type AttributionHints, hintsFromStripe, pickClick } from "./attribution";
import type { Attribution, BillingEvent, ParsedWebhook, Provider } from "./billing/types";
import {
  computeCommission,
  overrideAmount,
  productRateFor,
  refundShare,
  resolvePlan,
  toMrr,
} from "./commission";
import { type AppDb, db, type Tx } from "./db";
import { scoreReferral, selfRecruited } from "./fraud";
import { ecbRates, minorRate, saleRate } from "./fx";
import { enqueue } from "./jobs";

type Program = typeof program.$inferSelect;
type Partner = typeof partner.$inferSelect;
type Referral = typeof referral.$inferSelect;

const DAY = 86_400_000;

/** Process one verified provider webhook. Idempotent on (provider, eventId). */
export async function ingest(
  workspaceId: string,
  provider: Provider,
  parsed: ParsedWebhook,
): Promise<{ duplicate: boolean; effects: string[] }> {
  return db().transaction(async (tx) => {
    // before marking the event processed: with no program yet the route answers 503 and Stripe retries
    const programs = await tx.select().from(program).where(eq(program.workspaceId, workspaceId));
    if (programs.length === 0) return { duplicate: false, effects: ["no program"] };

    const inserted = await tx
      .insert(processedEvent)
      .values({ provider, eventId: parsed.eventId, workspaceId, type: parsed.eventType })
      .onConflictDoNothing()
      .returning({ id: processedEvent.eventId });
    if (inserted.length === 0) return { duplicate: true, effects: [] };

    const effects: string[] = [];
    for (const ev of parsed.events)
      effects.push(...(await handle(tx, provider, programs, ev, !parsed.livemode)));
    return { duplicate: false, effects };
  });
}

async function handle(
  tx: Tx,
  provider: Provider,
  programs: Program[],
  ev: BillingEvent,
  test = false,
): Promise<string[]> {
  switch (ev.type) {
    case "customer":
    case "checkout": {
      if (!ev.customerId) return [];
      const r = await resolveReferral(
        tx,
        programs,
        ev.customerId,
        ev.attribution,
        {
          email: ev.email,
          name: ev.name,
        },
        test,
      );
      if (r && ev.type === "checkout" && ev.subscriptionId && !r.externalSubscriptionId) {
        await tx
          .update(referral)
          .set({ externalSubscriptionId: ev.subscriptionId })
          .where(eq(referral.id, r.id));
      }
      if (!r) return [];
      return [`referral ${r.id}`, ...(await bookParked(tx, provider, programs, ev.customerId))];
    }
    case "payment":
      return handlePayment(tx, provider, programs, ev, test);
    case "refund":
      return handleRefund(tx, provider, programs, ev);
    case "dispute":
      return handleDispute(tx, provider, programs, ev);
    case "charge_link":
      return handleChargeLink(tx, provider, programs, ev);
    case "subscription": {
      const ids = programs.map((p) => p.id);
      const [r] = await tx
        .select()
        .from(referral)
        .where(and(inArray(referral.programId, ids), eq(referral.externalCustomerId, ev.customerId)));
      if (!r) return [];
      const status =
        ev.status === "trialing"
          ? "trialing"
          : ev.status === "canceled"
            ? "canceled"
            : ev.status === "active"
              ? "active"
              : r.status;
      // MRR is kept in the program's currency, like the revenue it sits next to
      const prog = programs.find((p) => p.id === r.programId);
      const rate = ev.currency && prog ? minorRate(ev.currency, prog.currency, await ecbRates(tx)) : 1;
      await tx
        .update(referral)
        .set({
          status,
          mrr: ev.status === "canceled" ? 0 : ev.mrr ? Math.round(ev.mrr * (rate ?? 1)) : r.mrr,
          canceledAt: ev.canceledAt,
          externalSubscriptionId: ev.subscriptionId,
        })
        .where(eq(referral.id, r.id));
      return [`referral ${r.id} → ${status}`];
    }
  }
}

/* ------------------------------------------------------------------ attribution */

export async function resolveReferral(
  tx: Tx | AppDb,
  programs: Program[],
  customerId: string,
  attribution: Attribution,
  who: { email: string | null; name: string | null },
  test = false,
): Promise<Referral | null> {
  const ids = programs.map((p) => p.id);
  const [existing] = await tx
    .select()
    .from(referral)
    .where(and(inArray(referral.programId, ids), eq(referral.externalCustomerId, customerId)));
  if (existing) return existing;

  const hints = hintsFromStripe({ ...attribution, email: who.email ?? attribution.email ?? null });
  const found = await findPartner(tx, programs, hints);
  if (!found) return null;
  const { partner: p, program: prog, via, clickId, visitorId, lead } = found;

  if (lead) {
    const [updated] = await tx
      .update(referral)
      .set({ externalCustomerId: customerId, name: lead.name ?? who.name })
      .where(eq(referral.id, lead.id))
      .returning();
    return updated ?? null;
  }

  const [created] = await tx
    .insert(referral)
    .values({
      id: createId("ref"),
      programId: prog.id,
      partnerId: p.id,
      clickId,
      visitorId,
      email: who.email,
      name: who.name,
      externalCustomerId: customerId,
      via,
      status: "lead",
      test,
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    // another delivery for the same customer inserted it first; use theirs
    const [raced] = await tx
      .select()
      .from(referral)
      .where(and(eq(referral.programId, prog.id), eq(referral.externalCustomerId, customerId)));
    return raced ?? null;
  }
  await afterNewReferral(tx, prog, p, created);
  return created;
}

async function findPartner(
  tx: Tx | AppDb,
  programs: Program[],
  hints: AttributionHints,
): Promise<{
  partner: Partner;
  program: Program;
  via: Referral["via"];
  clickId: string | null;
  visitorId: string | null;
  lead?: Referral;
} | null> {
  const ids = programs.map((p) => p.id);
  const byId = new Map(programs.map((p) => [p.id, p]));
  for (const { key, source } of ATTRIBUTION_ORDER) {
    const v = hints[key];
    if (!v) continue;
    if (key === "promoCode") {
      const [row] = await tx
        .select({ partner })
        .from(promoCode)
        .innerJoin(partner, eq(partner.id, promoCode.partnerId))
        // the code the customer typed, or the Stripe promotion code id when there was no key to look it up
        .where(
          and(
            inArray(promoCode.programId, ids),
            sql`(lower(${promoCode.code}) = lower(${v}) or ${promoCode.externalId} = ${v})`,
          ),
        );
      if (row)
        return {
          partner: row.partner,
          program: byId.get(row.partner.programId)!,
          via: "coupon",
          clickId: null,
          visitorId: hints.visitorId ?? null,
        };
    }
    if (key === "clickId") {
      const [row] = await tx
        .select({ click, partner })
        .from(click)
        .innerJoin(partner, eq(partner.id, click.partnerId))
        .where(and(inArray(click.programId, ids), eq(click.id, v)));
      if (row)
        return {
          partner: row.partner,
          program: byId.get(row.partner.programId)!,
          via: "link",
          clickId: row.click.id,
          visitorId: row.click.visitorId,
        };
    }
    if (key === "partnerCode") {
      const [row] = await tx
        .select()
        .from(partner)
        .where(and(inArray(partner.programId, ids), sql`lower(${partner.code}) = lower(${v})`));
      if (row)
        return {
          partner: row,
          program: byId.get(row.programId)!,
          via: "metadata",
          clickId: null,
          visitorId: hints.visitorId ?? null,
        };
    }
    if (key === "visitorId") {
      const clicks = await tx
        .select()
        .from(click)
        .where(and(inArray(click.programId, ids), eq(click.visitorId, v)))
        .orderBy(desc(click.createdAt))
        .limit(50);
      for (const prog of programs) {
        const chosen = pickClick(
          clicks.filter((c) => c.programId === prog.id),
          prog.attributionModel,
          new Date(),
          prog.cookieDays,
        );
        if (chosen) {
          const [p] = await tx.select().from(partner).where(eq(partner.id, chosen.partnerId));
          if (p) return { partner: p, program: prog, via: "link", clickId: chosen.id, visitorId: v };
        }
      }
    }
    if (key === "email") {
      const [lead] = await tx
        .select({ referral, partner })
        .from(referral)
        .innerJoin(partner, eq(partner.id, referral.partnerId))
        .where(
          and(
            inArray(referral.programId, ids),
            sql`lower(${referral.email}) = lower(${v})`,
            isNull(referral.externalCustomerId),
          ),
        )
        .orderBy(desc(referral.createdAt))
        .limit(1);
      if (lead)
        return {
          partner: lead.partner,
          program: byId.get(lead.partner.programId)!,
          via: lead.referral.via,
          clickId: lead.referral.clickId,
          visitorId: lead.referral.visitorId,
          lead: lead.referral,
        };
    }
    void source;
  }
  return null;
}

/** Lead commission, self-referral flag and signup bounties for a brand new referral. */
export async function afterNewReferral(
  tx: Tx | AppDb,
  prog: Program,
  p: Partner,
  r: Referral,
  opts: { browser?: boolean } = {},
) {
  const risk = scoreReferral(p, r);
  const risky = risk.score >= prog.fraudHoldScore;
  if (risk.reasons.includes("self-referral")) {
    await tx
      .insert(fraudFlag)
      .values({
        id: createId("frd"),
        programId: prog.id,
        partnerId: p.id,
        referralId: r.id,
        signal: "self_referral",
        score: 95,
        detail: "The referred customer's email matches the partner's.",
      })
      .onConflictDoNothing();
  }
  if (prog.leadCommission > 0 && p.status === "approved") {
    await tx
      .insert(commission)
      .values({
        id: createId("com"),
        programId: prog.id,
        workspaceId: prog.workspaceId,
        partnerId: p.id,
        referralId: r.id,
        kind: "lead",
        sourceKey: `lead:${r.id}`,
        amount: prog.leadCommission,
        currency: prog.currency,
        fxRate: 1,
        test: r.test,
        status: risky || opts.browser ? "held" : "pending",
        heldReason: risky
          ? `Risk ${risk.score}: ${risk.reasons.join(", ")}`
          : opts.browser
            ? "Signup reported by the browser script. Approve it once you know the signup is real."
            : null,
        holdUntil: new Date(Date.now() + prog.holdDays * DAY),
        description: "Signup",
      })
      .onConflictDoNothing();
  }
  await tx.update(partner).set({ lastActiveAt: new Date() }).where(eq(partner.id, p.id));
  await enqueue(
    "campaigns.evaluate",
    { programId: prog.id, partnerId: p.id, trigger: "signup", held: !!opts.browser },
    {},
    tx,
  );
  await enqueue(
    "events.emit",
    {
      workspaceId: prog.workspaceId,
      event: "referral.created",
      data: { id: r.id, programId: prog.id, partnerId: p.id, via: r.via },
    },
    {},
    tx,
  );
}

/* ------------------------------------------------------------------ money events */

type PaymentEvent = Extract<BillingEvent, { type: "payment" }>;
const PARK_MS = 2 * DAY;

/** Book payments that arrived before the event that names their partner. */
async function bookParked(tx: Tx, provider: Provider, programs: Program[], customerId: string) {
  const workspaceId = programs[0]!.workspaceId;
  const rows = await tx
    .delete(parkedPayment)
    .where(
      and(
        eq(parkedPayment.workspaceId, workspaceId),
        eq(parkedPayment.provider, provider),
        eq(parkedPayment.customerId, customerId),
        gte(parkedPayment.createdAt, new Date(Date.now() - PARK_MS)),
      ),
    )
    .returning();
  const out: string[] = [];
  for (const row of rows) {
    const ev = { ...row.event, paidAt: new Date(String(row.event.paidAt)) } as unknown as PaymentEvent;
    out.push(...(await handlePayment(tx, provider, programs, ev, row.test)));
  }
  return out;
}

export async function pruneParked(now = new Date()) {
  await db()
    .delete(parkedPayment)
    .where(lt(parkedPayment.createdAt, new Date(now.getTime() - PARK_MS)));
}

async function handlePayment(
  tx: Tx,
  provider: Provider,
  programs: Program[],
  ev: Extract<BillingEvent, { type: "payment" }>,
  test = false,
): Promise<string[]> {
  const r = await resolveReferral(
    tx,
    programs,
    ev.customerId,
    ev.attribution,
    {
      email: ev.email,
      name: null,
    },
    test,
  );
  if (!r) {
    await tx
      .insert(parkedPayment)
      .values({
        workspaceId: programs[0]!.workspaceId,
        provider,
        paymentId: ev.paymentId,
        customerId: ev.customerId,
        event: JSON.parse(JSON.stringify(ev)),
        test,
      })
      .onConflictDoNothing();
    return ["no partner yet; kept for two days"];
  }
  const prog = programs.find((p) => p.id === r.programId)!;
  const [p] = await tx.select().from(partner).where(eq(partner.id, r.partnerId));
  if (!p) return [];
  const group = p.groupId
    ? (await tx.select().from(partnerGroup).where(eq(partnerGroup.id, p.groupId)))[0]
    : null;
  const campaigns = await tx
    .select()
    .from(campaign)
    .where(and(eq(campaign.programId, prog.id), eq(campaign.status, "active")));

  // the sale in the program's currency, for revenue, MRR and the founder's reports
  // ponytail: with no rate known (offline self-host, rare currency) the amount counts 1:1, as before
  const rate = saleRate(ev, prog.currency, await ecbRates(tx));
  const inProgram = Math.round(ev.amount * (rate ?? 1));
  const plan = resolvePlan(prog, group, p.commissionOverride, productRateFor(prog.productRates, ev));
  // a fixed commission is an amount in the program's currency, whatever the customer paid in
  const fixedOther = plan.type !== "percent" && ev.currency.toLowerCase() !== prog.currency.toLowerCase();
  const result = computeCommission(
    plan,
    {
      amount: ev.amount,
      currency: ev.currency,
      paidAt: ev.paidAt,
      interval: ev.interval,
      firstPaidAt: r.convertedAt,
      priorPayments: r.paidInvoices,
    },
    campaigns,
    p.groupId,
  );

  await tx
    .update(referral)
    .set({
      revenue: sql`${referral.revenue} + ${inProgram}`,
      paidInvoices: sql`${referral.paidInvoices} + 1`,
      status: "active",
      convertedAt: r.convertedAt ?? ev.paidAt,
      mrr: ev.interval ? toMrr(inProgram, ev.interval, ev.intervalCount) : r.mrr,
      externalSubscriptionId: r.externalSubscriptionId ?? ev.subscriptionId,
    })
    .where(eq(referral.id, r.id));

  if (!result.eligible) return [`no commission: ${result.reason}`];

  const risk = scoreReferral(p, r);
  const hold =
    risk.score >= prog.fraudHoldScore
      ? `Risk score ${risk.score}: ${risk.reasons.join(", ") || "partner risk"}`
      : p.status !== "approved"
        ? `Partner is ${p.status}`
        : null;
  const [c] = await tx
    .insert(commission)
    .values({
      id: createId("com"),
      programId: prog.id,
      workspaceId: prog.workspaceId,
      partnerId: p.id,
      referralId: r.id,
      kind: "sale",
      sourceKey: `${provider}:${ev.paymentId}`,
      test,
      // a fixed commission is booked in the program's currency, so the sale is too (converted); the
      // customer's own charge is kept for the refund ratio
      saleAmount: fixedOther ? inProgram : ev.amount,
      chargedAmount: fixedOther ? ev.amount : null,
      amount: result.amount,
      currency: fixedOther ? prog.currency : ev.currency,
      fxRate: fixedOther ? 1 : rate,
      status: hold ? "held" : "pending",
      heldReason: hold,
      holdUntil: new Date(ev.paidAt.getTime() + prog.holdDays * DAY),
      campaignId: result.campaignId,
      externalChargeId: ev.chargeIds[0] ?? ev.paymentId,
      description: `${ev.description} · ${result.reason}${fixedOther ? ` (paid in ${ev.currency.toUpperCase()})` : ""}`,
    })
    .onConflictDoNothing()
    .returning();
  if (!c) return ["duplicate payment"];

  // keep every charge id so refunds on any of them map back, including links that arrived first
  const early = await tx
    .select({ chargeId: chargeLink.chargeId })
    .from(chargeLink)
    .where(
      and(
        eq(chargeLink.workspaceId, prog.workspaceId),
        eq(chargeLink.provider, provider),
        eq(chargeLink.paymentId, ev.paymentId),
      ),
    );
  await addChargeAliases(tx, c, [...ev.chargeIds.slice(1), ...early.map((l) => l.chargeId)]);
  await tx.update(partner).set({ lastActiveAt: new Date() }).where(eq(partner.id, p.id));
  await enqueue(
    "campaigns.evaluate",
    { programId: prog.id, partnerId: p.id, trigger: r.paidInvoices === 0 ? "first_sale" : "sale" },
    {},
    tx,
  );
  await enqueue("tiers.evaluate", { programId: prog.id, partnerId: p.id }, {}, tx);
  await enqueue(
    "events.emit",
    {
      workspaceId: prog.workspaceId,
      event: "commission.created",
      data: {
        id: c.id,
        kind: "sale",
        partnerId: p.id,
        amount: c.amount,
        currency: c.currency,
        status: c.status,
      },
    },
    {},
    tx,
  );
  await enqueue("notify.commission", { commissionId: c.id }, {}, tx);
  const ov = await bookOverride(tx, prog, p, r, c);
  // a refund or dispute that came in before this payment applies now
  const late = await replayChargeEvents(tx, provider, programs, [
    c.externalChargeId ?? "",
    ...ev.chargeIds,
    ...early.map((l) => l.chargeId),
  ]);
  return [`commission ${c.id} ${c.amount} ${c.status}`, ...(ov ? [ov] : []), ...late];
}

type ChargeEvent = Extract<BillingEvent, { type: "refund" | "dispute" }>;

/**
 * Stripe sends no order: charge.dispute.created can arrive before the invoice.paid that books the sale.
 * Such an event is kept (two days, like a parked payment) under its charge id and applied once a sale
 * with that charge exists.
 */
async function parkChargeEvent(tx: Tx, provider: Provider, programs: Program[], ev: ChargeEvent) {
  const key = ev.type === "refund" ? ev.refundKey : `${ev.disputeId}:${ev.status}`;
  await tx
    .insert(parkedPayment)
    .values({
      workspaceId: programs[0]!.workspaceId,
      provider,
      paymentId: `${ev.type}:${key}:${ev.chargeId}`,
      customerId: `charge:${ev.chargeId}`,
      event: JSON.parse(JSON.stringify(ev)),
    })
    .onConflictDoNothing();
  return [`kept ${ev.type} on ${ev.chargeId} for later`];
}

async function replayChargeEvents(tx: Tx, provider: Provider, programs: Program[], chargeIds: string[]) {
  const ids = [...new Set(chargeIds.filter(Boolean))].map((c) => `charge:${c}`);
  if (ids.length === 0) return [];
  const rows = await tx
    .delete(parkedPayment)
    .where(
      and(
        eq(parkedPayment.workspaceId, programs[0]!.workspaceId),
        eq(parkedPayment.provider, provider),
        inArray(parkedPayment.customerId, ids),
        gte(parkedPayment.createdAt, new Date(Date.now() - PARK_MS)),
      ),
    )
    .returning();
  // replay in arrival order, so "opened" comes before "won" or "lost"
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const out: string[] = [];
  for (const row of rows) {
    const ev = row.event as unknown as ChargeEvent;
    out.push(
      ...(ev.type === "refund"
        ? await handleRefund(tx, provider, programs, ev)
        : await handleDispute(tx, provider, programs, ev)),
    );
  }
  return out;
}

type Commission = typeof commission.$inferSelect;

/**
 * Two-tier: the recruiter of `sub` earns `program.overrideRate` of the sub-partner's sale commission.
 * One level only. The override shares the sale's hold date and charge id, so holds, refunds, disputes and
 * clawbacks reach it through `parent_id`.
 */
export async function bookOverride(
  tx: Tx,
  prog: Program,
  sub: Partner,
  r: Referral,
  sale: Commission,
): Promise<string | null> {
  if (prog.overrideRate <= 0 || !sub.recruitedBy || sale.amount <= 0) return null;
  const [rec] = await tx
    .select()
    .from(partner)
    .where(and(eq(partner.id, sub.recruitedBy), eq(partner.programId, prog.id)));
  if (!rec || rec.status === "rejected" || rec.status === "banned") return null;
  const amount = overrideAmount(sale.amount, prog.overrideRate);
  if (amount <= 0) return null;

  const risk = scoreReferral(rec, r);
  const self = selfRecruited(rec, sub);
  const hold = self
    ? `Recruited own account (${self})`
    : risk.score >= prog.fraudHoldScore
      ? `Risk score ${risk.score}: ${risk.reasons.join(", ") || "partner risk"}`
      : rec.status !== "approved"
        ? `Partner is ${rec.status}`
        : sale.status === "held"
          ? "Sub-partner commission held"
          : null;
  const [o] = await tx
    .insert(commission)
    .values({
      id: createId("com"),
      programId: prog.id,
      workspaceId: prog.workspaceId,
      partnerId: rec.id,
      referralId: r.id,
      kind: "override",
      parentId: sale.id,
      sourceKey: `override:${sale.id}`,
      test: sale.test,
      saleAmount: 0,
      amount,
      currency: sale.currency,
      fxRate: sale.fxRate,
      status: hold ? "held" : "pending",
      heldReason: hold,
      holdUntil: sale.holdUntil,
      externalChargeId: sale.externalChargeId,
      description: `${prog.overrideRate / 100}% of ${sub.name}'s commission`,
    })
    .onConflictDoNothing()
    .returning();
  if (!o) return null;
  if (self)
    await tx
      .insert(fraudFlag)
      .values({
        id: createId("frd"),
        programId: prog.id,
        partnerId: rec.id,
        referralId: "",
        signal: "self_recruit",
        score: 90,
        detail: `Recruited ${sub.name}, who looks like the same person (${self}).`,
      })
      .onConflictDoNothing();
  await enqueue(
    "events.emit",
    {
      workspaceId: prog.workspaceId,
      event: "commission.created",
      data: {
        id: o.id,
        kind: "override",
        partnerId: rec.id,
        parentCommissionId: sale.id,
        subPartnerId: sub.id,
        amount: o.amount,
        currency: o.currency,
        status: o.status,
      },
    },
    {},
    tx,
  );
  await enqueue("notify.commission", { commissionId: o.id }, {}, tx);
  return `override ${o.id} ${o.amount} ${o.status}`;
}

/** Zero-amount alias rows so a refund or dispute on any of these charges finds the sale commission. */
async function addChargeAliases(tx: Tx, c: Commission, chargeIds: string[]) {
  for (const extra of new Set(chargeIds)) {
    if (extra === c.externalChargeId) continue;
    await tx
      .insert(commission)
      .values({
        ...c,
        id: createId("com"),
        kind: "adjustment",
        sourceKey: `alias:${c.id}:${extra}`,
        amount: 0,
        saleAmount: 0,
        externalChargeId: extra,
        description: `Alias of ${c.id}`,
        parentId: null,
      })
      .onConflictDoNothing();
  }
}

/** Stripe's invoice_payment.paid: attach the charge to the invoice's commission, or keep it for later. */
async function handleChargeLink(
  tx: Tx,
  provider: Provider,
  programs: Program[],
  ev: Extract<BillingEvent, { type: "charge_link" }>,
): Promise<string[]> {
  const sales = await tx
    .select()
    .from(commission)
    .where(
      and(
        inArray(
          commission.programId,
          programs.map((p) => p.id),
        ),
        eq(commission.sourceKey, `${provider}:${ev.paymentId}`),
        eq(commission.kind, "sale"),
      ),
    );
  for (const c of sales) await addChargeAliases(tx, c, ev.chargeIds);
  if (sales.length)
    return [
      `linked ${ev.chargeIds.join(",")} to ${sales.map((c) => c.id).join(",")}`,
      ...(await replayChargeEvents(tx, provider, programs, ev.chargeIds)),
    ];
  const workspaceId = programs[0]!.workspaceId;
  for (const chargeId of ev.chargeIds)
    await tx
      .insert(chargeLink)
      .values({ workspaceId, provider, paymentId: ev.paymentId, chargeId })
      .onConflictDoNothing();
  return [`kept link ${ev.paymentId} for later`];
}

async function salesForCharge(tx: Tx, provider: Provider, programs: Program[], chargeId: string) {
  const ids = programs.map((p) => p.id);
  let rows = await tx
    .select()
    .from(commission)
    .where(and(inArray(commission.programId, ids), eq(commission.externalChargeId, chargeId)));
  if (rows.length === 0) {
    // the link and the payment raced and no alias was written: follow the stored link to the payment
    const links = await tx
      .select({ paymentId: chargeLink.paymentId })
      .from(chargeLink)
      .where(
        and(
          eq(chargeLink.workspaceId, programs[0]!.workspaceId),
          eq(chargeLink.provider, provider),
          eq(chargeLink.chargeId, chargeId),
        ),
      );
    if (links.length)
      rows = await tx
        .select()
        .from(commission)
        .where(
          and(
            inArray(commission.programId, ids),
            inArray(
              commission.sourceKey,
              links.map((l) => `${provider}:${l.paymentId}`),
            ),
          ),
        );
  }
  // resolve aliases to their sale commission
  const saleIds = new Set<string>();
  for (const r of rows) saleIds.add(r.kind === "sale" ? r.id : (r.sourceKey.split(":")[1] ?? r.id));
  if (saleIds.size === 0) return [];
  const sales = await tx
    .select()
    .from(commission)
    .where(and(inArray(commission.id, [...saleIds]), eq(commission.kind, "sale")));
  if (sales.length === 0) return sales;
  // two-tier overrides follow their sale: same refund share, same hold, same reversal
  const overrides = await tx
    .select()
    .from(commission)
    .where(
      and(
        inArray(
          commission.parentId,
          sales.map((c) => c.id),
        ),
        eq(commission.kind, "override"),
      ),
    );
  return [...sales, ...overrides];
}

export async function reverseFor(
  tx: Tx | AppDb,
  c: typeof commission.$inferSelect,
  refunded: number,
  charged: number,
  refundKey: string,
  reason: string,
): Promise<string | null> {
  const share = refundShare(c.amount, charged, refunded);
  const prior = await tx
    .select({
      amount: sql<number>`coalesce(sum(${commission.amount}), 0)::int`,
      sale: sql<number>`coalesce(sum(${commission.saleAmount}), 0)::int`,
    })
    .from(commission)
    .where(and(eq(commission.programId, c.programId), like(commission.sourceKey, `refund:${c.id}:%`)));
  const already = -(prior[0]?.amount ?? 0);
  const saleAlready = -(prior[0]?.sale ?? 0);
  const delta = share - already;
  const saleDelta =
    Math.min(c.saleAmount, Math.round((c.saleAmount * Math.min(refunded, charged)) / Math.max(charged, 1))) -
    saleAlready;
  if (delta <= 0 && saleDelta <= 0) return null;

  // an override's referral belongs to the sub-partner's sale, which updates it itself
  if (c.kind !== "override")
    await tx
      .update(referral)
      .set({
        revenue: sql`greatest(0, ${referral.revenue} - ${Math.round(Math.max(0, saleDelta) * (c.fxRate ?? 1))})`,
        ...(refunded >= charged ? { status: "refunded" as const } : {}),
      })
      .where(eq(referral.id, c.referralId ?? ""));

  // locked to a payout being sent counts as paid: the money is on its way, so claw back from the next one
  const unpaid = c.status !== "paid" && c.status !== "reversed" && !c.payoutId;
  if (unpaid && share >= c.amount) {
    await tx
      .update(commission)
      .set({ status: "reversed", heldReason: reason, updatedAt: new Date() })
      .where(eq(commission.id, c.id));
    await tx
      .update(commission)
      .set({ status: "reversed", updatedAt: new Date() })
      .where(and(eq(commission.programId, c.programId), like(commission.sourceKey, `refund:${c.id}:%`)));
    return `reversed ${c.id}`;
  }
  if (c.status === "reversed") return null;
  await tx
    .insert(commission)
    .values({
      id: createId("com"),
      programId: c.programId,
      workspaceId: c.workspaceId,
      partnerId: c.partnerId,
      referralId: c.referralId,
      kind: "adjustment",
      sourceKey: `refund:${c.id}:${refundKey}`,
      saleAmount: -Math.max(0, saleDelta),
      amount: -delta,
      currency: c.currency,
      fxRate: c.fxRate,
      test: c.test,
      // unpaid: nets out inside the same payout; paid: claws back from the next payout
      status: unpaid ? c.status : "approved",
      holdUntil: c.holdUntil,
      description: `${reason} (${unpaid ? "before payout" : "clawback after payout"})`,
    })
    .onConflictDoNothing();
  return `${unpaid ? "reduced" : "clawback"} ${c.id} by ${delta}`;
}

async function handleRefund(
  tx: Tx,
  provider: Provider,
  programs: Program[],
  ev: Extract<BillingEvent, { type: "refund" }>,
): Promise<string[]> {
  const out: string[] = [];
  const sales = await salesForCharge(tx, provider, programs, ev.chargeId);
  if (sales.length === 0) return parkChargeEvent(tx, provider, programs, ev);
  for (const c of sales) {
    // in the customer's currency, like `refunded`
    const charged = ev.charged > 0 ? ev.charged : (c.chargedAmount ?? c.saleAmount);
    let refunded = ev.refunded;
    if (ev.incremental) {
      // add the refunds already booked on this commission, scaled from sale units to the charge's units
      const [prior] = await tx
        .select({ sale: sql<number>`coalesce(sum(${commission.saleAmount}), 0)::int` })
        .from(commission)
        .where(and(eq(commission.programId, c.programId), like(commission.sourceKey, `refund:${c.id}:%`)));
      refunded += Math.round((-(prior?.sale ?? 0) * charged) / Math.max(c.saleAmount, 1));
    }
    const r = await reverseFor(
      tx,
      c,
      refunded,
      charged,
      ev.refundKey,
      refunded >= charged ? "Refunded" : "Partially refunded",
    );
    if (r) {
      out.push(r);
      await enqueue(
        "events.emit",
        {
          workspaceId: c.workspaceId,
          event: "commission.reversed",
          data: { id: c.id, refunded: ev.refunded },
        },
        {},
        tx,
      );
      if (c.status === "paid") await enqueue("fraud.rescore", { partnerId: c.partnerId }, {}, tx);
    }
  }
  return out;
}

async function handleDispute(
  tx: Tx,
  provider: Provider,
  programs: Program[],
  ev: Extract<BillingEvent, { type: "dispute" }>,
): Promise<string[]> {
  const out: string[] = [];
  const sales = await salesForCharge(tx, provider, programs, ev.chargeId);
  if (sales.length === 0) return parkChargeEvent(tx, provider, programs, ev);
  for (const c of sales) {
    if (ev.status === "opened" && (c.status === "pending" || c.status === "approved") && !c.payoutId) {
      await tx
        .update(commission)
        .set({ status: "held", heldReason: "Chargeback opened", updatedAt: new Date() })
        .where(eq(commission.id, c.id));
      out.push(`held ${c.id}`);
    } else if (ev.status === "won" && c.status === "held" && c.heldReason === "Chargeback opened") {
      await tx
        .update(commission)
        .set({ status: "pending", heldReason: null, updatedAt: new Date() })
        .where(eq(commission.id, c.id));
      out.push(`released ${c.id}`);
    } else if (ev.status === "lost") {
      const r = await reverseFor(
        tx,
        c,
        c.saleAmount || 1,
        c.saleAmount || 1,
        `dispute:${ev.disputeId}`,
        "Chargeback lost",
      );
      if (r) out.push(r);
    }
  }
  return out;
}
