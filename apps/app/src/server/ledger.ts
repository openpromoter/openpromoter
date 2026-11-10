import { commission, partner, payout, program } from "@openpromoter/db";
import { and, eq, inArray, isNull, like, lte, or, type SQL, sql } from "drizzle-orm";
import { createId } from "@/lib/id";
import { formatMoney } from "@/lib/money";
import { type Actor, audit } from "./audit";
import { type AppDb, db, type Tx } from "./db";
import { reverseFor } from "./ingest";
import { enqueue } from "./jobs";

export const SUB_HELD = "Sub-partner commission held";

/**
 * Two-tier: an override follows the sub-partner commission it was earned on. A hold holds it, a release
 * releases only what that hold caused, and a reversal reverses it (or claws it back once paid).
 */
export async function followOverrides(
  parentIds: string[],
  action: "hold" | "release" | "reverse",
  reason = "",
) {
  if (parentIds.length === 0) return 0;
  const now = new Date();
  const inParents = and(inArray(commission.parentId, parentIds), eq(commission.kind, "override"));
  if (action === "hold")
    return (
      await db()
        .update(commission)
        .set({ status: "held", heldReason: SUB_HELD, updatedAt: now })
        .where(
          and(inParents, inArray(commission.status, ["pending", "approved"]), isNull(commission.payoutId)),
        )
        .returning({ id: commission.id })
    ).length;
  if (action === "release")
    return (
      await db()
        .update(commission)
        .set({
          status: sql`case when ${commission.holdUntil} is null or ${commission.holdUntil} <= ${now.toISOString()}::timestamptz then 'approved' else 'pending' end`,
          heldReason: null,
          updatedAt: now,
        })
        .where(and(inParents, eq(commission.status, "held"), eq(commission.heldReason, SUB_HELD)))
        .returning({ id: commission.id })
    ).length;
  let n = 0;
  for (const o of await db().select().from(commission).where(inParents))
    if (await reverseFor(db(), o, 1, 1, "reversed", reason || "Sub-partner commission reversed")) n++;
  return n;
}

/**
 * A refund before payout books a negative `refund:<id>:…` adjustment with the parent's status. A manual
 * hold, release, approve or reverse of the parent moves those rows with it, so the payout nets correctly.
 */
async function followRefunds(
  programId: string,
  parentIds: string[],
  from: ("pending" | "approved" | "held")[],
  set: { status: "held" | "approved" | "reversed" | SQL; heldReason?: string | null },
) {
  if (parentIds.length === 0) return;
  await db()
    .update(commission)
    .set({ ...set, updatedAt: new Date() } as Partial<typeof commission.$inferInsert>)
    .where(
      and(
        eq(commission.programId, programId),
        eq(commission.kind, "adjustment"),
        inArray(commission.status, from),
        isNull(commission.payoutId),
        or(...parentIds.map((id) => like(commission.sourceKey, `refund:${id}:%`))),
      ),
    );
}

/** Pending → approved once the hold ends, 5,000 rows per statement (the literal status hits the partial index). */
export async function matureCommissions(now = new Date()): Promise<number> {
  let total = 0;
  for (;;) {
    const due = db()
      .select({ id: commission.id })
      .from(commission)
      .where(and(sql`${commission.status} = 'pending'`, lte(commission.holdUntil, now)))
      .limit(5000);
    const rows = await db()
      .update(commission)
      .set({ status: "approved", updatedAt: now })
      .where(and(inArray(commission.id, due), eq(commission.status, "pending")))
      .returning({ id: commission.id });
    total += rows.length;
    if (rows.length < 5000) return total;
  }
}

export async function holdCommissions(programId: string, ids: string[], reason: string, actor: Actor) {
  const rows = await db()
    .update(commission)
    .set({ status: "held", heldReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(commission.programId, programId),
        inArray(commission.id, ids),
        inArray(commission.status, ["pending", "approved"]),
        // a commission locked to a payout that is being sent can't change; refunds claw it back instead
        isNull(commission.payoutId),
      ),
    )
    .returning();
  await followRefunds(
    programId,
    rows.map((r) => r.id),
    ["pending", "approved"],
    { status: "held", heldReason: reason },
  );
  await followOverrides(
    rows.map((r) => r.id),
    "hold",
  );
  if (rows[0])
    await audit(
      rows[0].workspaceId,
      actor,
      "commission.hold",
      { type: "commission", id: ids.join(",") },
      { reason, count: rows.length },
    );
  return rows.length;
}

/** Releases held commissions: back to pending if still inside the hold window, else approved. */
export async function releaseCommissions(programId: string, ids: string[], actor: Actor) {
  const now = new Date();
  const rows = await db()
    .update(commission)
    .set({
      status: sql`case when ${commission.holdUntil} is null or ${commission.holdUntil} <= ${now.toISOString()}::timestamptz then 'approved' else 'pending' end`,
      heldReason: null,
      updatedAt: now,
    })
    .where(
      and(eq(commission.programId, programId), inArray(commission.id, ids), eq(commission.status, "held")),
    )
    .returning();
  await followRefunds(
    programId,
    rows.map((r) => r.id),
    ["held"],
    {
      status: sql`case when ${commission.holdUntil} is null or ${commission.holdUntil} <= ${now.toISOString()}::timestamptz then 'approved' else 'pending' end`,
      heldReason: null,
    },
  );
  await followOverrides(
    rows.map((r) => r.id),
    "release",
  );
  if (rows[0])
    await audit(
      rows[0].workspaceId,
      actor,
      "commission.release",
      { type: "commission", id: ids.join(",") },
      { count: rows.length },
    );
  return rows.length;
}

/** Founder approves early (skips the rest of the hold period). */
export async function approveCommissions(programId: string, ids: string[], actor: Actor) {
  const rows = await db()
    .update(commission)
    .set({ status: "approved", heldReason: null, updatedAt: new Date() })
    .where(
      and(
        eq(commission.programId, programId),
        inArray(commission.id, ids),
        inArray(commission.status, ["pending", "held"]),
      ),
    )
    .returning();
  await followRefunds(
    programId,
    rows.map((r) => r.id),
    ["pending", "held"],
    { status: "approved", heldReason: null },
  );
  await followOverrides(
    rows.map((r) => r.id),
    "release",
  );
  if (rows[0])
    await audit(
      rows[0].workspaceId,
      actor,
      "commission.approve",
      { type: "commission", id: ids.join(",") },
      { count: rows.length },
    );
  return rows.length;
}

export async function reverseCommissions(programId: string, ids: string[], reason: string, actor: Actor) {
  const rows = await db()
    .update(commission)
    .set({ status: "reversed", heldReason: reason, updatedAt: new Date() })
    .where(
      and(
        eq(commission.programId, programId),
        inArray(commission.id, ids),
        inArray(commission.status, ["pending", "approved", "held"]),
        isNull(commission.payoutId),
      ),
    )
    .returning();
  await followRefunds(
    programId,
    rows.map((r) => r.id),
    ["pending", "approved", "held"],
    { status: "reversed" },
  );
  await followOverrides(
    rows.map((r) => r.id),
    "reverse",
    reason,
  );
  if (rows[0])
    await audit(
      rows[0].workspaceId,
      actor,
      "commission.reverse",
      { type: "commission", id: ids.join(",") },
      { reason, count: rows.length },
    );
  return rows.length;
}

/** Manual commission or bonus. */
export async function createManualCommission(
  programId: string,
  input: {
    partnerId: string;
    amount: number;
    description: string;
    kind?: "bonus" | "adjustment";
    sourceKey?: string;
  },
  actor: Actor,
) {
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  const [p] = await db()
    .select()
    .from(partner)
    .where(and(eq(partner.id, input.partnerId), eq(partner.programId, programId)));
  if (!prog || !p) throw new Error("Partner not found in this program");
  const [c] = await db()
    .insert(commission)
    .values({
      id: createId("com"),
      programId,
      workspaceId: prog.workspaceId,
      partnerId: p.id,
      kind: input.kind ?? "bonus",
      sourceKey: input.sourceKey ?? `manual:${createId("com")}`,
      amount: input.amount,
      currency: prog.currency,
      fxRate: 1,
      status: "approved",
      description: input.description,
    })
    .onConflictDoNothing()
    .returning();
  if (c) {
    await audit(
      prog.workspaceId,
      actor,
      "commission.create",
      { type: "commission", id: c.id },
      { amount: c.amount, partnerId: p.id },
    );
    await enqueue("events.emit", {
      workspaceId: prog.workspaceId,
      event: "commission.created",
      data: {
        id: c.id,
        kind: c.kind,
        partnerId: p.id,
        amount: c.amount,
        currency: c.currency,
        status: c.status,
      },
    });
  }
  return c ?? null;
}

export interface Balance {
  partnerId: string;
  currency: string;
  approved: number;
  pending: number;
  held: number;
  paid: number;
}

const NO_BALANCE = { approved: 0, pending: 0, held: 0, paid: 0 };

/** The balance in the program's currency (zero when there is none). */
export const mainBalance = (bal: Pick<Balance, "currency" | keyof typeof NO_BALANCE>[], currency: string) =>
  bal.find((x) => x.currency === currency) ?? { ...NO_BALANCE, currency };

/**
 * A sale paid in another currency books its commission in that currency, so a partner can hold several.
 * "$120.00 + €45.00": the program's currency first (even at zero), then each other one that is not zero.
 */
export function moneyAcross(
  rows: { currency: string; n: number }[],
  main: string,
  opts: { whole?: boolean } = {},
): string {
  const fmt = (n: number, c: string) => (n < 0 ? `−${formatMoney(-n, c, opts)}` : formatMoney(n, c, opts));
  const other = rows.filter((r) => r.currency !== main && r.n !== 0);
  const own = rows.find((r) => r.currency === main)?.n ?? 0;
  return [fmt(own, main), ...other.map((r) => fmt(r.n, r.currency))].join(" + ");
}

/** For a narrow tile: the program's currency as the figure, the others as "+ €45.00" for the line below. */
export function splitAcross(
  rows: { currency: string; n: number }[],
  main: string,
  opts: { whole?: boolean } = {},
) {
  return {
    main: moneyAcross(
      rows.filter((r) => r.currency === main),
      main,
      opts,
    ),
    rest: rows
      .filter((r) => r.currency !== main && r.n !== 0)
      .map((r) => `+ ${formatMoney(r.n, r.currency, opts)}`)
      .join(" "),
  };
}

/** Approved balances in currencies other than the program's, e.g. "€45.00 + £12.00", or undefined. */
export function otherOwed(bal: Balance[], main: string): string | undefined {
  const rows = bal.filter((b) => b.currency !== main && b.approved !== 0);
  return rows.length ? rows.map((b) => formatMoney(b.approved, b.currency)).join(" + ") : undefined;
}

/** moneyAcross over one figure of each balance row, e.g. (b) => b.approved. */
export const balanceAcross = (
  bal: Balance[],
  main: string,
  pick: (b: Balance) => number,
  opts: { whole?: boolean } = {},
) =>
  moneyAcross(
    bal.map((b) => ({ currency: b.currency, n: pick(b) })),
    main,
    opts,
  );

/** Per-partner, per-currency balances. Approved unpaid includes clawbacks (negative rows). */
export async function balances(programId: string, partnerIds?: string[]): Promise<Balance[]> {
  const rows = await db()
    .select({
      partnerId: commission.partnerId,
      currency: commission.currency,
      approved: sql<number>`coalesce(sum(${commission.amount}) filter (where ${commission.status} = 'approved' and ${commission.payoutId} is null), 0)::int`,
      pending: sql<number>`coalesce(sum(${commission.amount}) filter (where ${commission.status} = 'pending'), 0)::int`,
      held: sql<number>`coalesce(sum(${commission.amount}) filter (where ${commission.status} = 'held'), 0)::int`,
      paid: sql<number>`coalesce(sum(${commission.amount}) filter (where ${commission.status} = 'paid'), 0)::int`,
    })
    .from(commission)
    .where(
      and(
        eq(commission.programId, programId),
        partnerIds ? inArray(commission.partnerId, partnerIds) : undefined,
      ),
    )
    .groupBy(commission.partnerId, commission.currency);
  return rows;
}

/** Partners owed at least the program minimum, ready to be paid. */
export async function payableBalances(programId: string, d: AppDb | Tx = db()) {
  const [prog] = await d.select().from(program).where(eq(program.id, programId));
  if (!prog) return [];
  const open = await d
    .select({ partnerId: payout.partnerId, test: payout.test })
    .from(payout)
    .where(and(eq(payout.programId, programId), inArray(payout.status, ["awaiting_approval", "processing"])));
  const busy = new Set(open.map((o) => `${o.partnerId}:${o.test}`));
  // test-mode and live commissions are paid apart, so a test sale can never ride along with real money
  const rows = await d
    .select({
      partnerId: commission.partnerId,
      currency: commission.currency,
      test: commission.test,
      approved: sql<number>`coalesce(sum(${commission.amount}), 0)::int`,
    })
    .from(commission)
    .where(
      and(
        eq(commission.programId, programId),
        eq(commission.status, "approved"),
        isNull(commission.payoutId),
      ),
    )
    .groupBy(commission.partnerId, commission.currency, commission.test);
  return rows.filter((b) => b.approved >= prog.minPayout && !busy.has(`${b.partnerId}:${b.test}`));
}

export const unpaidApproved = (programId: string, partnerId: string, currency: string, test = false) =>
  and(
    eq(commission.programId, programId),
    eq(commission.partnerId, partnerId),
    eq(commission.currency, currency),
    eq(commission.status, "approved"),
    isNull(commission.payoutId),
    eq(commission.test, test),
  );
