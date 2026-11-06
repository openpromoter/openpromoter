import { commission, fraudFlag, partner } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { BillingEvent, ParsedWebhook } from "@/server/billing/types";
import { overrideAmount } from "@/server/commission";
import { db } from "@/server/db";
import { selfRecruited } from "@/server/fraud";
import { ingest } from "@/server/ingest";
import { holdCommissions, releaseCommissions, reverseCommissions } from "@/server/ledger";
import { applyToProgram } from "@/server/partners";
import { addPartner, fixture } from "./helpers";

let n = 0;
const evt = (events: BillingEvent[]): ParsedWebhook => ({
  eventId: `evt_tt_${++n}_${Math.random()}`,
  eventType: "test",
  livemode: true,
  events,
});
const pay = (customerId: string, code: string, chargeId: string, amount = 10000): BillingEvent => ({
  type: "payment",
  paymentId: `in_${chargeId}`,
  chargeIds: [chargeId],
  customerId,
  email: `${customerId}@buyer.test`,
  subscriptionId: null,
  amount,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  paidAt: new Date(),
  attribution: { metadata: { op_ref: code } },
  description: "Pro plan",
});
const actor = { type: "user" as const, id: "u_test" };

/** Program at 30% with a 10% recruiter override; a recruiter and one sub-partner they recruited. */
async function team(overrideRate = 1000, sub: Partial<typeof partner.$inferInsert> = {}) {
  const f = await fixture({ commissionValue: 3000, overrideRate });
  const rec = await addPartner(f.program.id, f.ws.id, { name: "Rita Recruiter", signupIpHash: "ip-rita" });
  const s = await addPartner(f.program.id, f.ws.id, { name: "Sam Sub", recruitedBy: rec.id, ...sub });
  const rows = async (partnerId: string) =>
    db().select().from(commission).where(eq(commission.partnerId, partnerId));
  return { ...f, rec, sub: s, rows };
}

describe("two-tier overrides", () => {
  it("rounds the override share and caps it at 100%", () => {
    expect(overrideAmount(3000, 1000)).toBe(300);
    expect(overrideAmount(333, 1500)).toBe(50);
    expect(overrideAmount(3000, 0)).toBe(0);
    expect(overrideAmount(-300, 1000)).toBe(0);
    expect(overrideAmount(3000, 20_000)).toBe(3000);
  });

  it("books an override for the recruiter when a sub-partner earns a sale commission", async () => {
    const t = await team();
    const res = await ingest(t.ws.id, "stripe", evt([pay("cus_tt1", t.sub.code, "ch_tt1")]));
    expect(res.effects.some((e) => /^override .* 300 pending$/.test(e))).toBe(true);
    const [sale] = await t.rows(t.sub.id);
    const [ov] = await t.rows(t.rec.id);
    expect(sale).toMatchObject({ kind: "sale", amount: 3000 });
    expect(ov).toMatchObject({
      kind: "override",
      amount: 300,
      status: "pending",
      parentId: sale!.id,
      saleAmount: 0,
      sourceKey: `override:${sale!.id}`,
    });
    expect(ov!.holdUntil!.getTime()).toBe(sale!.holdUntil!.getTime());
    // replayed webhook does not double-book
    await ingest(t.ws.id, "stripe", evt([pay("cus_tt1", t.sub.code, "ch_tt1")]));
    expect(await t.rows(t.rec.id)).toHaveLength(1);
  });

  it("is off by default and pays no override above one level", async () => {
    const off = await team(0);
    await ingest(off.ws.id, "stripe", evt([pay("cus_tt2", off.sub.code, "ch_tt2")]));
    expect(await off.rows(off.rec.id)).toHaveLength(0);

    const t = await team();
    const grandchild = await addPartner(t.program.id, t.ws.id, { recruitedBy: t.sub.id });
    await ingest(t.ws.id, "stripe", evt([pay("cus_tt3", grandchild.code, "ch_tt3")]));
    expect(await t.rows(t.sub.id)).toHaveLength(1); // the direct recruiter's override
    expect(await t.rows(t.rec.id)).toHaveLength(0); // nothing two levels up
  });

  it("reduces the override on a partial refund and reverses it on a full refund", async () => {
    const t = await team();
    await ingest(t.ws.id, "stripe", evt([pay("cus_tt4", t.sub.code, "ch_tt4")]));
    await ingest(
      t.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "ch_tt4", refundKey: "re_1", refunded: 5000, charged: 10000 }]),
    );
    const partial = await t.rows(t.rec.id);
    expect(partial.reduce((s, c) => s + c.amount, 0)).toBe(150);
    await ingest(
      t.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "ch_tt4", refundKey: "re_2", refunded: 10000, charged: 10000 }]),
    );
    const after = await t.rows(t.rec.id);
    expect(after.every((c) => c.status === "reversed")).toBe(true);
  });

  it("claws back a paid override after a refund", async () => {
    const t = await team();
    await ingest(t.ws.id, "stripe", evt([pay("cus_tt5", t.sub.code, "ch_tt5")]));
    await db().update(commission).set({ status: "paid" }).where(eq(commission.partnerId, t.rec.id));
    await ingest(
      t.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "ch_tt5", refundKey: "re_5", refunded: 10000, charged: 10000 }]),
    );
    const rows = await t.rows(t.rec.id);
    const claw = rows.find((c) => c.kind === "adjustment");
    expect(claw).toMatchObject({ amount: -300, status: "approved" });
    expect(claw!.description).toMatch(/clawback/);
  });

  it("holds the override during a dispute, releases it on a win and reverses it on a loss", async () => {
    const t = await team();
    await ingest(t.ws.id, "stripe", evt([pay("cus_tt6", t.sub.code, "ch_tt6")]));
    const ov = async () => (await t.rows(t.rec.id))[0]!;
    await ingest(
      t.ws.id,
      "stripe",
      evt([{ type: "dispute", chargeId: "ch_tt6", disputeId: "dp_1", status: "opened" }]),
    );
    expect(await ov()).toMatchObject({ status: "held", heldReason: "Chargeback opened" });
    await ingest(
      t.ws.id,
      "stripe",
      evt([{ type: "dispute", chargeId: "ch_tt6", disputeId: "dp_1", status: "won" }]),
    );
    expect((await ov()).status).toBe("pending");
    await ingest(
      t.ws.id,
      "stripe",
      evt([{ type: "dispute", chargeId: "ch_tt6", disputeId: "dp_2", status: "lost" }]),
    );
    expect((await ov()).status).toBe("reversed");
  });

  it("follows the founder's hold, release and reversal of the sub-partner commission", async () => {
    const t = await team();
    await ingest(t.ws.id, "stripe", evt([pay("cus_tt7", t.sub.code, "ch_tt7")]));
    const [sale] = await t.rows(t.sub.id);
    const ov = async () => (await t.rows(t.rec.id))[0]!;
    await holdCommissions(t.program.id, [sale!.id], "Checking", actor);
    expect(await ov()).toMatchObject({ status: "held", heldReason: "Sub-partner commission held" });
    await releaseCommissions(t.program.id, [sale!.id], actor);
    expect((await ov()).status).toBe("pending");
    await reverseCommissions(t.program.id, [sale!.id], "Fraud", actor);
    expect((await ov()).status).toBe("reversed");
  });

  it("holds the override when the sub-partner's own commission is held", async () => {
    const t = await team(1000, { status: "paused" });
    await ingest(t.ws.id, "stripe", evt([pay("cus_tt8", t.sub.code, "ch_tt8")]));
    const [ov] = await t.rows(t.rec.id);
    expect(ov).toMatchObject({ status: "held", heldReason: "Sub-partner commission held" });
  });

  it("holds and flags an override when the recruit is the recruiter's own account", async () => {
    expect(
      selfRecruited(
        { email: "rita@gmail.com", userId: null, signupIpHash: null, paypalEmail: null, wiseEmail: null },
        {
          email: "r.i.t.a+2@gmail.com",
          userId: null,
          signupIpHash: null,
          paypalEmail: null,
          wiseEmail: null,
        },
      ),
    ).toBe("same email");
    const t = await team(1000, { signupIpHash: "ip-rita" });
    await ingest(t.ws.id, "stripe", evt([pay("cus_tt9", t.sub.code, "ch_tt9")]));
    const [ov] = await t.rows(t.rec.id);
    expect(ov).toMatchObject({ status: "held", heldReason: "Recruited own account (same network)" });
    const flags = await db()
      .select()
      .from(fraudFlag)
      .where(and(eq(fraudFlag.partnerId, t.rec.id), eq(fraudFlag.signal, "self_recruit")));
    expect(flags).toHaveLength(1);
  });

  it("links a new partner to an approved recruiter of the same program only", async () => {
    const t = await team();
    const joined = await applyToProgram(t.program, {
      email: "new-sub@x.test",
      name: "New Sub",
      recruiterCode: t.rec.code.toUpperCase(),
    });
    expect(joined.partner.recruitedBy).toBe(t.rec.id);

    const pending = await addPartner(t.program.id, t.ws.id, { status: "pending" });
    const viaPending = await applyToProgram(t.program, {
      email: "sub2@x.test",
      name: "Sub Two",
      recruiterCode: pending.code,
    });
    expect(viaPending.partner.recruitedBy).toBeNull();

    // the database refuses a recruiter from another program
    const other = await fixture();
    const outsider = await addPartner(other.program.id, other.ws.id);
    await expect(
      db().update(partner).set({ recruitedBy: outsider.id }).where(eq(partner.id, t.sub.id)),
    ).rejects.toThrow();
    await expect(
      db().update(partner).set({ recruitedBy: t.sub.id }).where(eq(partner.id, t.sub.id)),
    ).rejects.toThrow();
  });
});
