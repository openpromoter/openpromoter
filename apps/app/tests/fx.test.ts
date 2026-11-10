import { commission, partnerGroup, referral } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createId } from "@/lib/id";
import { overview, topPartners } from "@/server/analytics";
import { normalizeLemonSqueezy } from "@/server/billing/lemonsqueezy";
import { normalizePaddle } from "@/server/billing/paddle";
import type { BillingEvent, ParsedWebhook } from "@/server/billing/types";
import { monthlyUsage } from "@/server/billing-plans";
import { evaluateTiers } from "@/server/campaigns";
import { db } from "@/server/db";
import {
  type EcbRates,
  fillMissingRates,
  minorRate,
  parseEcb,
  rebaseProgram,
  refreshRates,
  saleRate,
  storeRates,
  sumIn,
} from "@/server/fx";
import { ingest } from "@/server/ingest";
import { recordClick } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

// 1 EUR = 1.25 USD = 0.80 GBP = 160 JPY: round numbers so every expected value is exact
const TABLE: EcbRates = { date: "2026-11-09", rates: { eur: 1, usd: 1.25, gbp: 0.8, jpy: 160 } };
const XML = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube><Cube time='2026-11-09'>
<Cube currency='USD' rate='1.25'/><Cube currency='JPY' rate='160'/><Cube currency='GBP' rate='0.80'/>
<Cube currency='CHF' rate='0.93'/><Cube currency='SEK' rate='11.2'/><Cube currency='NOK' rate='11.7'/>
<Cube currency='PLN' rate='4.3'/><Cube currency='CZK' rate='24.3'/><Cube currency='DKK' rate='7.46'/>
<Cube currency='AUD' rate='1.7'/><Cube currency='CAD' rate='1.6'/></Cube></Cube></gesmes:Envelope>`;

let n = 0;
const evt = (events: BillingEvent[]): ParsedWebhook => ({
  eventId: `evt_fx_${++n}_${Math.random()}`,
  eventType: "test",
  livemode: false,
  events,
});

async function referred(over = {}) {
  const f = await fixture(over);
  const p = await addPartner(f.program.id, f.ws.id);
  const click = (await recordClick({
    programId: f.program.id,
    code: p.code,
    landingUrl: `https://acme.test/?via=${p.code}`,
    userAgent: "Mozilla/5.0",
    ip: "1.2.3.4",
  }))!;
  const customerId = `cus_${Math.random()}`;
  await ingest(
    f.ws.id,
    "stripe",
    evt([
      {
        type: "checkout",
        customerId,
        email: null,
        name: null,
        subscriptionId: "sub_fx",
        attribution: { clientReferenceId: click.clickId },
      },
    ]),
  );
  return { ...f, partner: p, customerId };
}

const pay = (customerId: string, o: Partial<Extract<BillingEvent, { type: "payment" }>>) =>
  ({
    type: "payment",
    paymentId: `in_${Math.random()}`,
    chargeIds: [`ch_${Math.random()}`],
    customerId,
    email: null,
    subscriptionId: "sub_fx",
    amount: 10000,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    paidAt: new Date(),
    attribution: {},
    description: "Pro",
    ...o,
  }) as Extract<BillingEvent, { type: "payment" }>;

const sales = (partnerId: string) =>
  db()
    .select()
    .from(commission)
    .where(and(eq(commission.partnerId, partnerId), eq(commission.kind, "sale")));
const allTime = { from: new Date(0), to: new Date(Date.now() + 86_400_000) };

describe("exchange rates", () => {
  beforeEach(async () => {
    await storeRates(TABLE);
  });

  it("reads the ECB daily file", () => {
    const t = parseEcb(XML)!;
    expect(t.date).toBe("2026-11-09");
    expect(t.rates).toMatchObject({ eur: 1, usd: 1.25, jpy: 160, gbp: 0.8 });
    expect(parseEcb("<html>maintenance</html>")).toBeNull();
  });

  it("converts minor units, including zero-decimal currencies", () => {
    expect(minorRate("usd", "usd", null)).toBe(1);
    expect(minorRate("eur", "usd", TABLE)).toBeCloseTo(1.25); // €1.00 = $1.25
    expect(minorRate("usd", "jpy", TABLE)).toBeCloseTo(1.28); // 100 cents = $1 = ¥128
    expect(minorRate("jpy", "usd", TABLE)).toBeCloseTo(0.78125); // ¥1 = 0.78125 cents
    expect(minorRate("xyz", "usd", TABLE)).toBeNull();
    expect(minorRate("eur", "usd", null)).toBeNull();
    expect(
      sumIn(
        [
          { currency: "eur", n: 1000 },
          { currency: "usd", n: 500 },
        ],
        "usd",
        TABLE,
      ),
    ).toBe(1750);
  });

  it("prefers the provider's own merchant-currency figure", () => {
    const ev = { amount: 10000, currency: "eur", base: { currency: "usd", amount: 11800 } };
    expect(saleRate(ev, "usd", TABLE)).toBeCloseTo(1.18); // provider's rate, not ECB's 1.25
    expect(saleRate({ ...ev, base: null }, "usd", TABLE)).toBeCloseTo(1.25);
    // settled in USD, program in GBP: provider figure, then USD→GBP from ECB (0.8 / 1.25)
    expect(saleRate(ev, "gbp", TABLE)).toBeCloseTo(1.18 * 0.64);
    expect(saleRate({ amount: 500, currency: "usd" }, "usd", null)).toBe(1);
  });

  it("Paddle and Lemon Squeezy pass the sale in the merchant's currency", () => {
    const paddle = normalizePaddle({
      event_type: "transaction.completed",
      data: {
        id: "txn_1",
        customer_id: "ctm_1",
        currency_code: "EUR",
        billed_at: "2026-11-09T10:00:00Z",
        details: {
          totals: { subtotal: "10000", discount: "1000" },
          payout_totals: { subtotal: "11800", currency_code: "USD" },
        },
        items: [{ price: { id: "pri_1", billing_cycle: { interval: "month", frequency: 1 } } }],
      },
    }).events[0] as Extract<BillingEvent, { type: "payment" }>;
    expect(paddle.amount).toBe(9000);
    expect(paddle.base).toEqual({ currency: "usd", amount: 10620 }); // 9000 × 11800 / 10000

    const ls = normalizeLemonSqueezy({
      meta: { event_name: "order_created" },
      data: {
        id: 7,
        attributes: {
          status: "paid",
          customer_id: 3,
          currency: "GBP",
          subtotal: 2000,
          discount_total: 0,
          subtotal_usd: 2500,
        },
      },
    }).events[0] as Extract<BillingEvent, { type: "payment" }>;
    expect(ls.base).toEqual({ currency: "usd", amount: 2500 });

    // no payout totals yet (or a USD-only store): no figure, ECB covers it
    const plain = normalizePaddle({
      event_type: "transaction.completed",
      data: {
        id: "txn_2",
        customer_id: "ctm_1",
        currency_code: "EUR",
        details: { totals: { subtotal: "5000" } },
      },
    }).events[0] as Extract<BillingEvent, { type: "payment" }>;
    expect(plain.base).toBeNull();
  });

  it("books a euro sale for a dollar program at the ECB rate, in revenue and reports", async () => {
    const s = await referred({ currency: "usd", commissionValue: 3000 });
    await ingest(s.ws.id, "stripe", evt([pay(s.customerId, { amount: 10000, currency: "eur" })]));
    const [c] = await sales(s.partner.id);
    // the partner earns and is paid in euros
    expect(c).toMatchObject({ currency: "eur", amount: 3000, saleAmount: 10000 });
    expect(c!.fxRate).toBeCloseTo(1.25);
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, s.customerId));
    expect(r).toMatchObject({ revenue: 12500, mrr: 12500 }); // dollars
    const o = await overview(s.program.id, allTime);
    expect(o.revenue).toBe(12500);
    expect(o.commissions).toBe(3750);
    expect(o.mrr).toBe(12500);
    const [top] = await topPartners(s.program.id, allTime);
    expect(Number(top?.revenue)).toBe(12500);
  });

  it("uses the provider's figure over ECB when the payload has one", async () => {
    const s = await referred({ currency: "usd" });
    await ingest(
      s.ws.id,
      "paddle",
      evt([pay(s.customerId, { amount: 10000, currency: "eur", base: { currency: "usd", amount: 11800 } })]),
    );
    const [c] = await sales(s.partner.id);
    expect(c!.fxRate).toBeCloseTo(1.18);
    expect((await overview(s.program.id, allTime)).revenue).toBe(11800);
  });

  it("a partial refund and the recruiter's override carry the sale's rate", async () => {
    const s = await referred({ currency: "usd", commissionValue: 3000, overrideRate: 1000 });
    const recruiter = await addPartner(s.program.id, s.ws.id);
    const { partner } = await import("@openpromoter/db");
    await db().update(partner).set({ recruitedBy: recruiter.id }).where(eq(partner.id, s.partner.id));
    await ingest(
      s.ws.id,
      "stripe",
      evt([pay(s.customerId, { amount: 10000, currency: "eur", chargeIds: [`ch_fx_${s.customerId}`] })]),
    );
    const [ov] = await db().select().from(commission).where(eq(commission.partnerId, recruiter.id));
    expect(ov).toMatchObject({ kind: "override", currency: "eur" });
    expect(ov!.fxRate).toBeCloseTo(1.25);

    await ingest(
      s.ws.id,
      "stripe",
      evt([
        { type: "refund", chargeId: `ch_fx_${s.customerId}`, refundKey: "a", refunded: 5000, charged: 10000 },
      ]),
    );
    const adj = (await db().select().from(commission).where(eq(commission.partnerId, s.partner.id))).find(
      (x) => x.kind === "adjustment",
    );
    expect(adj).toMatchObject({ currency: "eur", amount: -1500, saleAmount: -5000 });
    expect(adj!.fxRate).toBeCloseTo(1.25);
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, s.customerId));
    expect(r?.revenue).toBe(6250); // $125 − $62.50
    expect((await overview(s.program.id, allTime)).revenue).toBe(6250);
  });

  it("fills rows that waited for a rate, and re-points rates when the program currency changes", async () => {
    await storeRates({ date: "2026-11-01", rates: { eur: 1 } }); // no USD yet
    const s = await referred({ currency: "usd" });
    await ingest(s.ws.id, "stripe", evt([pay(s.customerId, { amount: 10000, currency: "eur" })]));
    await ingest(s.ws.id, "stripe", evt([pay(s.customerId, { amount: 4000, currency: "usd" })]));
    let rows = await sales(s.partner.id);
    expect(rows.find((x) => x.currency === "eur")!.fxRate).toBeNull();
    expect(rows.find((x) => x.currency === "usd")!.fxRate).toBe(1);

    await storeRates(TABLE);
    expect(await fillMissingRates()).toBeGreaterThanOrEqual(1);
    rows = await sales(s.partner.id);
    expect(rows.find((x) => x.currency === "eur")!.fxRate).toBeCloseTo(1.25);

    // the founder switches the program to euros
    const [before] = await db().select().from(referral).where(eq(referral.externalCustomerId, s.customerId));
    const { program } = await import("@openpromoter/db");
    await db().update(program).set({ currency: "eur" }).where(eq(program.id, s.program.id));
    await rebaseProgram(s.program.id, "usd", "eur");
    rows = await sales(s.partner.id);
    expect(rows.find((x) => x.currency === "eur")!.fxRate).toBe(1);
    expect(rows.find((x) => x.currency === "usd")!.fxRate).toBeCloseTo(0.8);
    const [after] = await db().select().from(referral).where(eq(referral.externalCustomerId, s.customerId));
    expect(after!.revenue).toBe(Math.round(before!.revenue * 0.8));
    expect((await overview(s.program.id, allTime)).revenue).toBe(10000 + 3200);
  });

  it("tier promotion compares converted revenue, so yen sales do not count as cents", async () => {
    const { partner } = await import("@openpromoter/db");
    const tierAfter = async (yen: number) => {
      const s = await referred({ currency: "usd" });
      await db()
        .insert(partnerGroup)
        .values({
          id: createId("grp"),
          programId: s.program.id,
          name: "Pro",
          rank: 2,
          promoteAtRevenue: 100_000,
        });
      await ingest(s.ws.id, "stripe", evt([pay(s.customerId, { amount: yen, currency: "jpy" })]));
      await evaluateTiers(s.program.id, s.partner.id);
      const [pt] = await db().select().from(partner).where(eq(partner.id, s.partner.id));
      const [g] = await db().select().from(partnerGroup).where(eq(partnerGroup.id, pt!.groupId!));
      return g?.name;
    };
    // ¥200,000 = $1,562.50: over the $1,000 line
    expect(await tierAfter(200_000)).toBe("Pro");
    // ¥120,000 = $937.50: under it (read as 120,000 cents, $1,200, before this fix)
    expect(await tierAfter(120_000)).not.toBe("Pro");
  });

  it("a fixed commission on a euro sale books the sale's value, and refunds of both kinds net correctly", async () => {
    const fixed = { currency: "usd", commissionType: "fixed" as const, commissionValue: 5000 };
    const net = async (partnerId: string) =>
      (await db().select().from(commission).where(eq(commission.partnerId, partnerId))).reduce(
        (t, x) => ({
          amount: t.amount + (x.status === "reversed" ? 0 : x.amount),
          sale: t.sale + (x.status === "reversed" ? 0 : x.saleAmount),
        }),
        { amount: 0, sale: 0 },
      );

    // Stripe-style: the refund carries the running total and what was charged
    const s = await referred(fixed);
    const ch = `ch_fix_${s.customerId}`;
    await ingest(
      s.ws.id,
      "stripe",
      evt([pay(s.customerId, { amount: 10000, currency: "eur", chargeIds: [ch] })]),
    );
    const [c] = await sales(s.partner.id);
    // $50 in the program's currency; the €100 sale counts as $125 and keeps €100 for refunds
    expect(c).toMatchObject({
      currency: "usd",
      amount: 5000,
      saleAmount: 12500,
      chargedAmount: 10000,
      fxRate: 1,
    });
    expect((await overview(s.program.id, allTime)).revenue).toBe(12500);
    await ingest(
      s.ws.id,
      "stripe",
      evt([{ type: "refund", chargeId: ch, refundKey: "a", refunded: 5000, charged: 10000 }]),
    );
    expect(await net(s.partner.id)).toEqual({ amount: 2500, sale: 6250 });
    expect((await overview(s.program.id, allTime)).revenue).toBe(6250);

    // Paddle-style: each refund is only its own amount and nothing says what was charged
    const t = await referred(fixed);
    const tch = `ch_fix_${t.customerId}`;
    await ingest(
      t.ws.id,
      "paddle",
      evt([pay(t.customerId, { amount: 10000, currency: "eur", chargeIds: [tch] })]),
    );
    for (const [key, amt] of [
      ["r1", 3000],
      ["r2", 2000],
    ] as const)
      await ingest(
        t.ws.id,
        "paddle",
        evt([
          { type: "refund", chargeId: tch, refundKey: key, refunded: amt, charged: 0, incremental: true },
        ]),
      );
    // €30 + €20 of €100 back: half the commission and half the sale
    expect(await net(t.partner.id)).toEqual({ amount: 2500, sale: 6250 });
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, t.customerId));
    expect(r?.revenue).toBe(6250);
  });

  it("plan usage turns each program's sales into USD", async () => {
    const s = await referred({ currency: "eur" });
    await ingest(s.ws.id, "stripe", evt([pay(s.customerId, { amount: 10000, currency: "eur" })]));
    // test-mode sales never count
    expect(await monthlyUsage(s.ws.id)).toBe(0);
    await db().update(commission).set({ test: false }).where(eq(commission.programId, s.program.id));
    expect(await monthlyUsage(s.ws.id)).toBe(12500);
  });

  it("converts MRR from subscription events", async () => {
    const s = await referred({ currency: "usd" });
    await ingest(
      s.ws.id,
      "stripe",
      evt([
        {
          type: "subscription",
          subscriptionId: "sub_fx",
          customerId: s.customerId,
          status: "active",
          mrr: 2000,
          currency: "gbp",
          canceledAt: null,
        },
      ]),
    );
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, s.customerId));
    expect(r?.mrr).toBe(3125); // £20 = €25 = $31.25
  });

  it("refreshes from the ECB file and fills waiting rows", async () => {
    await storeRates({ date: "2026-11-01", rates: { eur: 1 } });
    const s = await referred({ currency: "usd" });
    await ingest(s.ws.id, "stripe", evt([pay(s.customerId, { amount: 10000, currency: "gbp" })]));
    const fake = (async () => new Response(XML, { status: 200 })) as unknown as typeof fetch;
    const t = await refreshRates(fake);
    expect(t?.rates.gbp).toBe(0.8);
    const [c] = await sales(s.partner.id);
    expect(c!.fxRate).toBeCloseTo(1.5625); // £1 = €1.25 = $1.5625
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await expect(refreshRates(down)).rejects.toThrow(/503/);
  });
});
