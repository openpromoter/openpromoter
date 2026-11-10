import { commission, fraudFlag, program, referral } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { BillingEvent, ParsedWebhook } from "@/server/billing/types";
import { db } from "@/server/db";
import { SYSTEM } from "@/server/audit";
import { ingest } from "@/server/ingest";
import { approveCommissions, holdCommissions, releaseCommissions, reverseCommissions } from "@/server/ledger";
import { createPromoCode } from "@/server/partners";
import { recordClick } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

let n = 0;
const evt = (events: BillingEvent[]): ParsedWebhook => ({
  eventId: `evt_${++n}_${Math.random()}`,
  eventType: "test",
  livemode: false,
  events,
});
const payment = (
  customerId: string,
  o: Partial<Extract<BillingEvent, { type: "payment" }>> = {},
): Extract<BillingEvent, { type: "payment" }> => ({
  type: "payment",
  paymentId: `in_${Math.random()}`,
  chargeIds: [`ch_${Math.random()}`],
  customerId,
  email: null,
  subscriptionId: "sub_1",
  amount: 10000,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  paidAt: new Date(),
  attribution: {},
  description: "Pro plan",
  ...o,
});

async function setup(over = {}) {
  const f = await fixture(over);
  const p = await addPartner(f.program.id, f.ws.id);
  const click = await recordClick({
    programId: f.program.id,
    code: p.code,
    landingUrl: `https://acme.test/?via=${p.code}`,
    userAgent: "Mozilla/5.0",
    ip: "1.2.3.4",
  });
  return { ...f, partner: p, click: click! };
}

describe("click → checkout → invoice → commission", () => {
  it("attributes via client_reference_id and books a held-for-refunds commission", async () => {
    const s = await setup();
    await ingest(
      s.ws.id,
      "stripe",
      evt([
        {
          type: "checkout",
          customerId: "cus_A",
          email: "buyer@x.test",
          name: "Buyer",
          subscriptionId: "sub_1",
          attribution: { clientReferenceId: s.click.clickId },
        },
      ]),
    );
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_A"));
    expect(r?.partnerId).toBe(s.partner.id);
    expect(r?.via).toBe("link");

    const res = await ingest(s.ws.id, "stripe", evt([payment("cus_A")]));
    expect(res.effects[0]).toMatch(/commission .* 3000 pending/);
    const [c] = await db().select().from(commission).where(eq(commission.partnerId, s.partner.id));
    expect(c?.status).toBe("pending");
    expect(c!.holdUntil!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const [r2] = await db().select().from(referral).where(eq(referral.id, r!.id));
    expect(r2).toMatchObject({ status: "active", paidInvoices: 1, revenue: 10000, mrr: 10000 });
  });

  it("is idempotent on event id and on payment id", async () => {
    const s = await setup();
    await ingest(
      s.ws.id,
      "stripe",
      evt([
        {
          type: "customer",
          customerId: "cus_B",
          email: null,
          name: null,
          attribution: { metadata: { op_click: s.click.clickId } },
          createdAt: new Date(),
        },
      ]),
    );
    const p = payment("cus_B", { paymentId: "in_dup" });
    const e = evt([p]);
    await ingest(s.ws.id, "stripe", e);
    expect((await ingest(s.ws.id, "stripe", e)).duplicate).toBe(true);
    await ingest(s.ws.id, "stripe", evt([p]));
    const rows = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, s.partner.id), eq(commission.kind, "sale")));
    expect(rows).toHaveLength(1);
  });

  it("ignores customers nobody referred", async () => {
    const s = await setup();
    const res = await ingest(s.ws.id, "stripe", evt([payment("cus_none")]));
    expect(res.effects).toEqual(["no partner yet; kept for two days"]);
    expect(await db().select().from(commission).where(eq(commission.programId, s.program.id))).toEqual([]);
  });

  it("coupon codes attribute without a cookie", async () => {
    const s = await setup();
    await createPromoCode(s.program.id, s.partner.id, "PAT20");
    await ingest(s.ws.id, "stripe", evt([payment("cus_C", { attribution: { promoCode: "pat20" } })]));
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_C"));
    expect(r?.via).toBe("coupon");
  });

  it("stops paying after the recurring window", async () => {
    const s = await setup({ commissionDuration: "months", commissionMonths: 2 });
    await ingest(
      s.ws.id,
      "stripe",
      evt([
        {
          type: "checkout",
          customerId: "cus_D",
          email: null,
          name: null,
          subscriptionId: null,
          attribution: { clientReferenceId: s.click.clickId },
        },
      ]),
    );
    const t0 = new Date("2026-01-05T00:00:00Z");
    for (const [i, m] of [0, 1, 2].entries()) {
      await ingest(
        s.ws.id,
        "stripe",
        evt([
          payment("cus_D", {
            paymentId: `in_win_${i}`,
            paidAt: new Date(t0.getTime() + m * 31 * 86_400_000),
          }),
        ]),
      );
    }
    const rows = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, s.partner.id), eq(commission.kind, "sale")));
    expect(rows).toHaveLength(2);
  });

  it("holds self-referrals and flags them", async () => {
    const s = await setup();
    await ingest(
      s.ws.id,
      "stripe",
      evt([
        {
          type: "checkout",
          customerId: "cus_E",
          email: s.partner.email,
          name: null,
          subscriptionId: null,
          attribution: { clientReferenceId: s.click.clickId },
        },
      ]),
    );
    await ingest(s.ws.id, "stripe", evt([payment("cus_E", { email: s.partner.email })]));
    const [c] = await db().select().from(commission).where(eq(commission.partnerId, s.partner.id));
    expect(c?.status).toBe("held");
    const flags = await db().select().from(fraudFlag).where(eq(fraudFlag.partnerId, s.partner.id));
    expect(flags[0]?.signal).toBe("self_referral");
  });
});

describe("refunds, chargebacks, cancellations", () => {
  async function paid(customerId: string) {
    const s = await setup();
    await ingest(
      s.ws.id,
      "stripe",
      evt([
        {
          type: "checkout",
          customerId,
          email: null,
          name: null,
          subscriptionId: "sub_x",
          attribution: { clientReferenceId: s.click.clickId },
        },
      ]),
    );
    await ingest(s.ws.id, "stripe", evt([payment(customerId, { chargeIds: [`ch_${customerId}`] })]));
    const [c] = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, s.partner.id), eq(commission.kind, "sale")));
    return { s, c: c! };
  }
  const sum = async (partnerId: string) =>
    (await db().select().from(commission).where(eq(commission.partnerId, partnerId)))
      .filter((r) => r.status !== "reversed")
      .reduce((a, r) => a + r.amount, 0);

  it("partial refund reduces an unpaid commission; second refund only claws the difference", async () => {
    const { s } = await paid("cus_R1");
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "ch_cus_R1", refundKey: "a", refunded: 5000, charged: 10000 }]),
    );
    expect(await sum(s.partner.id)).toBe(1500);
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "ch_cus_R1", refundKey: "b", refunded: 7500, charged: 10000 }]),
    );
    expect(await sum(s.partner.id)).toBe(750);
  });

  it("full refund of an unpaid commission reverses it", async () => {
    const { s, c } = await paid("cus_R2");
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "ch_cus_R2", refundKey: "a", refunded: 10000, charged: 10000 }]),
    );
    const [after] = await db().select().from(commission).where(eq(commission.id, c.id));
    expect(after?.status).toBe("reversed");
    expect(await sum(s.partner.id)).toBe(0);
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_R2"));
    expect(r?.status).toBe("refunded");
  });

  it("refund after payout creates an approved clawback for the next payout", async () => {
    const { s, c } = await paid("cus_R3");
    await db().update(commission).set({ status: "paid" }).where(eq(commission.id, c.id));
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "ch_cus_R3", refundKey: "a", refunded: 10000, charged: 10000 }]),
    );
    const rows = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, s.partner.id), eq(commission.kind, "adjustment")));
    expect(rows[0]).toMatchObject({ amount: -3000, status: "approved" });
  });

  it("chargeback holds, won releases, lost reverses", async () => {
    const { s, c } = await paid("cus_R4");
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "dispute", chargeId: "ch_cus_R4", disputeId: "dp_1", status: "opened" }]),
    );
    expect((await db().select().from(commission).where(eq(commission.id, c.id)))[0]?.status).toBe("held");
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "dispute", chargeId: "ch_cus_R4", disputeId: "dp_1", status: "won" }]),
    );
    expect((await db().select().from(commission).where(eq(commission.id, c.id)))[0]?.status).toBe("pending");
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "dispute", chargeId: "ch_cus_R4", disputeId: "dp_2", status: "lost" }]),
    );
    expect((await db().select().from(commission).where(eq(commission.id, c.id)))[0]?.status).toBe("reversed");
  });

  it("cancellation marks the referral canceled with zero MRR", async () => {
    await paid("cus_R5");
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_R5"));
    const [prog] = await db().select().from(program).where(eq(program.id, r!.programId));
    await ingest(
      prog!.workspaceId,
      "stripe",
      evt([
        {
          type: "subscription",
          subscriptionId: "sub_x",
          customerId: "cus_R5",
          status: "canceled",
          mrr: 0,
          canceledAt: new Date(),
        },
      ]),
    );
    const [after] = await db().select().from(referral).where(eq(referral.id, r!.id));
    expect(after).toMatchObject({ status: "canceled", mrr: 0 });
  });

  it("a manual reverse, hold, release or approve moves the refund adjustment with its commission", async () => {
    const statuses = async (partnerId: string) =>
      (await db().select().from(commission).where(eq(commission.partnerId, partnerId)))
        .map((r) => `${r.kind}:${r.status}`)
        .sort();
    const refund = (s: Awaited<ReturnType<typeof paid>>["s"], id: string) =>
      ingest(
        s.ws.id,
        "stripe",
        evt([{ type: "refund", chargeId: `ch_${id}`, refundKey: "a", refunded: 5000, charged: 10000 }]),
      );

    const a = await paid("cus_L1");
    await refund(a.s, "cus_L1");
    await reverseCommissions(a.s.program.id, [a.c.id], "Fraud", SYSTEM);
    expect(await statuses(a.s.partner.id)).toEqual(["adjustment:reversed", "sale:reversed"]);

    const b = await paid("cus_L2");
    await holdCommissions(b.s.program.id, [b.c.id], "Review", SYSTEM);
    await refund(b.s, "cus_L2");
    expect(await statuses(b.s.partner.id)).toEqual(["adjustment:held", "sale:held"]);
    await approveCommissions(b.s.program.id, [b.c.id], SYSTEM);
    expect(await statuses(b.s.partner.id)).toEqual(["adjustment:approved", "sale:approved"]);
    expect(await sum(b.s.partner.id)).toBe(1500);

    const c = await paid("cus_L3");
    await refund(c.s, "cus_L3");
    await holdCommissions(c.s.program.id, [c.c.id], "Review", SYSTEM);
    expect(await statuses(c.s.partner.id)).toEqual(["adjustment:held", "sale:held"]);
    await releaseCommissions(c.s.program.id, [c.c.id], SYSTEM);
    expect(await statuses(c.s.partner.id)).toEqual(["adjustment:pending", "sale:pending"]);
  });
});

describe("invoice_payment.paid links an invoice to its charge", () => {
  // Stripe invoices since API 2025-03 carry no charge id, so refunds only map back through this link.
  async function referred(customerId: string) {
    const s = await setup();
    await ingest(
      s.ws.id,
      "stripe",
      evt([
        {
          type: "checkout",
          customerId,
          email: null,
          name: null,
          subscriptionId: "sub_l",
          attribution: { clientReferenceId: s.click.clickId },
        },
      ]),
    );
    return s;
  }
  /** What the partner is owed after refunds: the sale plus its negative adjustments. */
  const owed = async (partnerId: string) =>
    (await db().select().from(commission).where(eq(commission.partnerId, partnerId)))
      .filter((r) => r.status !== "reversed")
      .reduce((a, r) => a + r.amount, 0);
  const refund = (chargeId: string) =>
    evt([{ type: "refund", chargeId, refundKey: `${chargeId}:5000`, refunded: 5000, charged: 10000 }]);

  it("without the link a refund on the payment intent changes nothing", async () => {
    const s = await referred("cus_L0");
    await ingest(s.ws.id, "stripe", evt([payment("cus_L0", { paymentId: "in_L0", chargeIds: [] })]));
    await ingest(s.ws.id, "stripe", refund("pi_L0"));
    expect(await owed(s.partner.id)).toBe(3000);
  });

  it("a refund on the linked payment intent halves the commission when the link comes after the payment", async () => {
    const s = await referred("cus_L1");
    await ingest(s.ws.id, "stripe", evt([payment("cus_L1", { paymentId: "in_L1", chargeIds: [] })]));
    expect(await owed(s.partner.id)).toBe(3000);
    await ingest(s.ws.id, "stripe", evt([{ type: "charge_link", paymentId: "in_L1", chargeIds: ["pi_L1"] }]));
    await ingest(s.ws.id, "stripe", refund("pi_L1"));
    expect(await owed(s.partner.id)).toBe(1500);
  });

  it("a link that arrives before the payment is kept and applied when the commission is booked", async () => {
    const s = await referred("cus_L2");
    await ingest(s.ws.id, "stripe", evt([{ type: "charge_link", paymentId: "in_L2", chargeIds: ["pi_L2"] }]));
    await ingest(s.ws.id, "stripe", evt([payment("cus_L2", { paymentId: "in_L2", chargeIds: [] })]));
    await ingest(s.ws.id, "stripe", refund("pi_L2"));
    expect(await owed(s.partner.id)).toBe(1500);
  });
});
