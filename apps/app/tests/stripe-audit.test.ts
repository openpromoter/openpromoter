import { chargeLink, commission, parkedPayment, referral } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { normalizeStripe } from "@/server/billing/stripe";
import type { BillingEvent, ParsedWebhook } from "@/server/billing/types";
import { db } from "@/server/db";
import { ingest } from "@/server/ingest";
import { recordClick } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

// Regression tests for the Stripe ingest audit of 2026-11-05.
let n = 0;
const evt = (events: BillingEvent[], livemode = true): ParsedWebhook => ({
  eventId: `evt_${++n}_${Math.random()}`,
  eventType: "test",
  livemode,
  events,
});
const stripeEvt = (type: string, object: Record<string, unknown>) =>
  ({ id: `evt_${++n}`, type, livemode: true, data: { object } }) as unknown as Stripe.Event;
const payment = (customerId: string, o: Partial<Extract<BillingEvent, { type: "payment" }>> = {}) =>
  ({
    type: "payment",
    paymentId: `in_${Math.random()}`,
    chargeIds: [],
    customerId,
    email: null,
    subscriptionId: "sub_1",
    amount: 4900,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    paidAt: new Date(),
    attribution: {},
    description: "Pro",
    ...o,
  }) as Extract<BillingEvent, { type: "payment" }>;

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
const sales = (programId: string) =>
  db()
    .select()
    .from(commission)
    .where(and(eq(commission.programId, programId), eq(commission.kind, "sale")));

describe("event order", () => {
  it("books the first invoice when invoice.paid comes before checkout.session.completed", async () => {
    const s = await setup();
    await ingest(s.ws.id, "stripe", evt([payment("cus_O", { paymentId: "in_first" })]));
    expect(await sales(s.program.id)).toHaveLength(0);
    const res = await ingest(
      s.ws.id,
      "stripe",
      evt([
        {
          type: "checkout",
          customerId: "cus_O",
          email: null,
          name: null,
          subscriptionId: "sub_1",
          attribution: { clientReferenceId: s.click.clickId },
        },
      ]),
    );
    expect(res.effects.some((e) => e.startsWith("referral"))).toBe(true);
    const rows = await sales(s.program.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceKey).toBe("stripe:in_first");
    expect(await db().select().from(parkedPayment).where(eq(parkedPayment.workspaceId, s.ws.id))).toEqual([]);
  });

  it("a refund finds the sale through a stored link even with no alias", async () => {
    const s = await setup();
    await ingest(
      s.ws.id,
      "stripe",
      evt([payment("cus_L", { paymentId: "in_L", attribution: { clientReferenceId: s.click.clickId } })]),
    );
    // the link committed after the payment looked for it, so no alias row exists
    await db()
      .insert(chargeLink)
      .values({ workspaceId: s.ws.id, provider: "stripe", paymentId: "in_L", chargeId: "pi_L" });
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "pi_L", refundKey: "re_1", refunded: 4900, charged: 4900 }]),
    );
    const [c] = await sales(s.program.id);
    expect(c?.status).toBe("reversed");
  });

  it("a dispute that arrives before invoice.paid still holds the commission", async () => {
    const s = await setup();
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "dispute", chargeId: "pi_D", disputeId: "du_1", status: "opened" }]),
    );
    await ingest(s.ws.id, "stripe", evt([{ type: "charge_link", paymentId: "in_D", chargeIds: ["pi_D"] }]));
    const res = await ingest(
      s.ws.id,
      "stripe",
      evt([payment("cus_D", { paymentId: "in_D", attribution: { clientReferenceId: s.click.clickId } })]),
    );
    expect(res.effects.some((e) => e.startsWith("held"))).toBe(true);
    const [c] = await sales(s.program.id);
    expect(c?.status).toBe("held");
    expect(c?.heldReason).toBe("Chargeback opened");
  });

  it("a refund that arrives before its link applies when the link comes", async () => {
    const s = await setup();
    await ingest(
      s.ws.id,
      "stripe",
      evt([payment("cus_R", { paymentId: "in_R", attribution: { clientReferenceId: s.click.clickId } })]),
    );
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "pi_R", refundKey: "re_R", refunded: 4900, charged: 4900 }]),
    );
    expect((await sales(s.program.id))[0]?.status).toBe("pending");
    await ingest(s.ws.id, "stripe", evt([{ type: "charge_link", paymentId: "in_R", chargeIds: ["pi_R"] }]));
    expect((await sales(s.program.id))[0]?.status).toBe("reversed");
  });

  it("does not consume events before a program exists", async () => {
    const s = await setup();
    const res = await ingest(`${s.ws.id}_none`, "stripe", evt([payment("cus_X")]));
    expect(res.effects).toEqual(["no program"]);
  });
});

describe("normalizeStripe", () => {
  it("a paid one-time Checkout payment becomes a payment, net of tax", async () => {
    const p = await normalizeStripe(
      stripeEvt("checkout.session.completed", {
        id: "cs_1",
        mode: "payment",
        payment_status: "paid",
        customer: null,
        amount_total: 5500,
        total_details: { amount_tax: 500 },
        currency: "usd",
        payment_intent: "pi_1",
        client_reference_id: "clk_1",
        customer_details: { email: "a@b.test" },
        created: 1_700_000_000,
      }),
    );
    expect(p.events.map((e) => e.type)).toEqual(["checkout", "payment"]);
    const pay = p.events[1] as Extract<BillingEvent, { type: "payment" }>;
    expect(pay.amount).toBe(5000);
    expect(pay.customerId).toBe("guest:cs_1");
    expect(pay.chargeIds).toEqual(["pi_1"]);
    expect((p.events[0] as { customerId: string }).customerId).toBe("guest:cs_1");
  });

  it("skips the Checkout payment when an invoice covers it", async () => {
    const p = await normalizeStripe(
      stripeEvt("checkout.session.completed", {
        id: "cs_2",
        mode: "payment",
        payment_status: "paid",
        invoice: "in_2",
        amount_total: 100,
      }),
    );
    expect(p.events.map((e) => e.type)).toEqual(["checkout"]);
  });

  it("an inquiry that closes without a chargeback releases the hold", async () => {
    for (const status of ["warning_closed", "prevented", "won"]) {
      const p = await normalizeStripe(
        stripeEvt("charge.dispute.closed", { id: "dp_1", charge: "ch_1", status }),
      );
      expect((p.events[0] as { status: string }).status).toBe("won");
    }
    const lost = await normalizeStripe(
      stripeEvt("charge.dispute.closed", { id: "dp_1", charge: "ch_1", status: "lost" }),
    );
    expect((lost.events[0] as { status: string }).status).toBe("lost");
  });

  it("reads the interval from the billing period on current invoices", async () => {
    const p = await normalizeStripe(
      stripeEvt("invoice.paid", {
        id: "in_b",
        customer: "cus_b",
        currency: "usd",
        amount_paid: 9900,
        lines: { data: [{ period: { start: 1_700_000_000, end: 1_700_000_000 + 365 * 86_400 } }] },
      }),
    );
    expect((p.events[0] as { interval: string }).interval).toBe("year");
  });

  it("expands bare discount ids to find the promotion code", async () => {
    const p = await normalizeStripe(
      stripeEvt("invoice.paid", {
        id: "in_d",
        customer: "cus_d",
        currency: "usd",
        amount_paid: 100,
        discounts: ["di_1"],
      }),
      { invoicePromo: async () => "promo_1", promoCode: async () => "PAT20" },
    );
    expect((p.events[0] as Extract<BillingEvent, { type: "payment" }>).attribution.promoCode).toBe("PAT20");
  });
});

describe("ledger", () => {
  it("a fixed commission is booked in the program currency", async () => {
    const s = await setup({ commissionType: "fixed", commissionValue: 1000 });
    await ingest(
      s.ws.id,
      "stripe",
      evt([
        payment("cus_J", {
          currency: "jpy",
          amount: 5000,
          attribution: { clientReferenceId: s.click.clickId },
        }),
      ]),
    );
    const [c] = await sales(s.program.id);
    expect(c?.currency).toBe("usd");
    expect(c?.amount).toBe(1000);
  });

  it("test-mode lead and refund rows are marked test", async () => {
    const s = await setup({ leadCommission: 200 });
    await ingest(
      s.ws.id,
      "stripe",
      evt(
        [
          payment("cus_T", {
            paymentId: "in_T",
            chargeIds: ["ch_T"],
            attribution: { clientReferenceId: s.click.clickId },
          }),
        ],
        false,
      ),
    );
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: "ch_T", refundKey: "re_T", refunded: 1000, charged: 4900 }], false),
    );
    const rows = await db().select().from(commission).where(eq(commission.programId, s.program.id));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => r.test)).toBe(true);
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_T"));
    expect(r?.test).toBe(true);
  });
});
