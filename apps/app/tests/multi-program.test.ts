import { commission, partnerGroup, program } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createCode, createId } from "@/lib/id";
import type { BillingEvent, ParsedWebhook } from "@/server/billing/types";
import { db } from "@/server/db";
import { ingest } from "@/server/ingest";
import { recordClick } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

// One founder with several programs on one Stripe account, and several founders side by side.
let n = 0;
const evt = (events: BillingEvent[]): ParsedWebhook => ({
  eventId: `evt_mp_${++n}_${Math.random()}`,
  eventType: "test",
  livemode: true,
  events,
});
const checkout = (customerId: string, attribution: Record<string, string>): BillingEvent => ({
  type: "checkout",
  customerId,
  email: null,
  name: null,
  subscriptionId: `sub_${customerId}`,
  attribution,
});
const payment = (customerId: string): BillingEvent => ({
  type: "payment",
  paymentId: `in_${Math.random()}`,
  chargeIds: [],
  customerId,
  email: null,
  subscriptionId: `sub_${customerId}`,
  amount: 10000,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
  paidAt: new Date(),
  attribution: {},
  description: "Pro",
});
const sales = (programId: string) =>
  db()
    .select()
    .from(commission)
    .where(and(eq(commission.programId, programId), eq(commission.kind, "sale")));

async function addProgram(workspaceId: string, commissionValue: number) {
  const [p] = await db()
    .insert(program)
    .values({
      id: createId("prg"),
      workspaceId,
      name: "Second",
      slug: `second-${createCode(6)}`,
      websiteUrl: "https://second.test",
      brand: { color: "#2442F5" },
      commissionType: "percent",
      commissionValue,
      autoApprove: {
        enabled: true,
        maxRiskScore: 40,
        requireWebsite: false,
        blockedCountries: [],
        allowedEmailDomains: [],
      },
      doubleSided: { enabled: false, percentOff: 0, durationMonths: 0 },
      holdDays: 30,
      minPayout: 5000,
    })
    .returning();
  await db()
    .insert(partnerGroup)
    .values({ id: createId("grp"), programId: p!.id, name: "Partner", isDefault: true });
  return p!;
}
const clickFor = async (programId: string, code: string) =>
  (await recordClick({
    programId,
    code,
    landingUrl: `https://x.test/?via=${code}`,
    userAgent: "Mozilla/5.0",
    ip: "1.2.3.4",
  }))!.clickId;

describe("several programs", () => {
  it("one Stripe account, two programs: each sale lands in its own program at its own rate", async () => {
    const f = await fixture({ commissionType: "percent", commissionValue: 3000 });
    const b = await addProgram(f.ws.id, 1000);
    const pa = await addPartner(f.program.id, f.ws.id);
    const pb = await addPartner(b.id, f.ws.id);
    await ingest(
      f.ws.id,
      "stripe",
      evt([
        checkout("cus_MA", { clientReferenceId: await clickFor(f.program.id, pa.code) }),
        payment("cus_MA"),
      ]),
    );
    await ingest(
      f.ws.id,
      "stripe",
      evt([checkout("cus_MB", { metadata: { op_ref: pb.code } } as never), payment("cus_MB")]),
    );
    await ingest(
      f.ws.id,
      "stripe",
      evt([checkout("cus_MB2", { clientReferenceId: await clickFor(b.id, pb.code) }), payment("cus_MB2")]),
    );
    const [a, bb] = [await sales(f.program.id), await sales(b.id)];
    expect(a.map((c) => [c.partnerId, c.amount])).toEqual([[pa.id, 3000]]);
    expect(bb.map((c) => [c.partnerId, c.amount])).toEqual([
      [pb.id, 1000],
      [pb.id, 1000],
    ]);
  });

  it("two founders with the same Stripe customer id never see each other's sales", async () => {
    const f1 = await fixture({ commissionType: "percent", commissionValue: 3000 });
    const f2 = await fixture({ commissionType: "percent", commissionValue: 2000 });
    const p1 = await addPartner(f1.program.id, f1.ws.id);
    const p2 = await addPartner(f2.program.id, f2.ws.id);
    await ingest(
      f1.ws.id,
      "stripe",
      evt([
        checkout("cus_SAME", { clientReferenceId: await clickFor(f1.program.id, p1.code) }),
        payment("cus_SAME"),
      ]),
    );
    await ingest(
      f2.ws.id,
      "stripe",
      evt([
        checkout("cus_SAME", { clientReferenceId: await clickFor(f2.program.id, p2.code) }),
        payment("cus_SAME"),
      ]),
    );
    // a click id from founder 1 sent to founder 2's webhook is ignored
    await ingest(
      f2.ws.id,
      "stripe",
      evt([
        checkout("cus_STOLEN", { clientReferenceId: await clickFor(f1.program.id, p1.code) }),
        payment("cus_STOLEN"),
      ]),
    );
    expect((await sales(f1.program.id)).map((c) => [c.partnerId, c.amount])).toEqual([[p1.id, 3000]]);
    expect((await sales(f2.program.id)).map((c) => [c.partnerId, c.amount])).toEqual([[p2.id, 2000]]);
  });
});
