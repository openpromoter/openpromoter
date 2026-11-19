import { commission, referral } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { normalizeDodo } from "@/server/billing/dodo";
import type { Json } from "@/server/billing/types";
import { db } from "@/server/db";
import { ingest } from "@/server/ingest";
import { recordClick } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

let n = 0;
const send = (wsId: string, body: Json) =>
  ingest(wsId, "dodo", normalizeDodo({ ...body, __id: `msg_${++n}_${Math.random()}` }, false));

async function setup() {
  const f = await fixture();
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

const paid = (customerId: string, paymentId: string, metadata: Json = {}) => ({
  type: "payment.succeeded",
  timestamp: new Date().toISOString(),
  data: {
    payload_type: "Payment",
    payment_id: paymentId,
    customer: { customer_id: customerId, email: "buyer@x.test", name: "Buyer" },
    subscription_id: "sub_d1",
    total_amount: 11800,
    tax: 1800,
    currency: "USD",
    settlement_amount: 11800,
    settlement_tax: 1800,
    settlement_currency: "USD",
    metadata,
    created_at: new Date().toISOString(),
  },
});

describe("Dodo Payments end to end", () => {
  it("click id in metadata → commission on the pre-tax amount → partial then full refund", async () => {
    const s = await setup();
    const res = await send(s.ws.id, paid("cus_d1", "pay_d1", { op_click: s.click.clickId }));
    expect(res.effects.join(" ")).toMatch(/commission .* 3000 pending/);

    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_d1"));
    expect(r).toMatchObject({ partnerId: s.partner.id, status: "active", revenue: 10000 });

    await send(s.ws.id, {
      type: "subscription.active",
      data: {
        subscription_id: "sub_d1",
        customer: { customer_id: "cus_d1" },
        status: "active",
        recurring_pre_tax_amount: 10000,
        currency: "USD",
        payment_frequency_interval: "Month",
        payment_frequency_count: 1,
      },
    });
    const [r2] = await db().select().from(referral).where(eq(referral.id, r!.id));
    expect(r2?.mrr).toBe(10000);

    // the same delivery twice books once
    const dup = normalizeDodo({ ...paid("cus_d1", "pay_d1"), __id: "msg_dup" }, false);
    await ingest(s.ws.id, "dodo", dup);
    await ingest(s.ws.id, "dodo", dup);
    const sales = await db().select().from(commission).where(eq(commission.partnerId, s.partner.id));
    expect(sales.filter((c) => c.kind === "sale")).toHaveLength(1);

    await send(s.ws.id, {
      type: "refund.succeeded",
      data: { refund_id: "rfd_1", payment_id: "pay_d1", amount: 2500, is_partial: true },
    });
    const total = (await db().select().from(commission).where(eq(commission.partnerId, s.partner.id))).reduce(
      (a, c) => a + c.amount,
      0,
    );
    expect(total).toBe(2250);

    await send(s.ws.id, {
      type: "refund.succeeded",
      data: { refund_id: "rfd_2", payment_id: "pay_d1", amount: 11800, is_partial: false },
    });
    // unpaid, so the sale and its partial adjustment are reversed in place rather than clawed back
    const after = await db().select().from(commission).where(eq(commission.partnerId, s.partner.id));
    expect(after.every((c) => c.status === "reversed")).toBe(true);
    const [r3] = await db().select().from(referral).where(eq(referral.id, r!.id));
    expect(r3?.status).toBe("refunded");
  });

  it("a payment with no click id or code stays unattributed", async () => {
    const s = await setup();
    const res = await send(s.ws.id, paid("cus_d2", "pay_d2"));
    expect(res.effects.join(" ")).not.toMatch(/commission/);
  });
});
