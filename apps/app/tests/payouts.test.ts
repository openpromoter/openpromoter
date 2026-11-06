import { commission, partner, payout } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createId } from "@/lib/id";
import { db } from "@/server/db";
import { balances, matureCommissions, payableBalances } from "@/server/ledger";
import { approvePayouts, createPayoutBatch, markPaid, payoutsCsv } from "@/server/payouts";
import { addPartner, fixture } from "./helpers";

async function withCommissions(
  amounts: number[],
  status: "pending" | "approved" = "pending",
  holdUntil = new Date(Date.now() - 1000),
) {
  const f = await fixture();
  const p = await addPartner(f.program.id, f.ws.id, { payoutMethod: "manual" });
  for (const a of amounts) {
    await db()
      .insert(commission)
      .values({
        id: createId("com"),
        programId: f.program.id,
        workspaceId: f.ws.id,
        partnerId: p.id,
        kind: a < 0 ? "adjustment" : "sale",
        sourceKey: createId("com"),
        amount: a,
        currency: "usd",
        status: a < 0 ? "approved" : status,
        holdUntil,
      });
  }
  return { ...f, partner: p };
}

const user = (id: string) => ({ type: "user" as const, id });

describe("payout ledger", () => {
  it("matures pending commissions after the hold period only", async () => {
    const f = await withCommissions([3000]);
    const g = await withCommissions([3000], "pending", new Date(Date.now() + 86_400_000));
    await matureCommissions();
    expect((await balances(f.program.id))[0]?.approved).toBe(3000);
    expect((await balances(g.program.id))[0]?.pending).toBe(3000);
  });

  it("only partners above the minimum are payable; clawbacks net out", async () => {
    const low = await withCommissions([3000], "approved");
    expect(await payableBalances(low.program.id)).toHaveLength(0);
    const netted = await withCommissions([4000, 3000, -1500], "approved");
    expect((await payableBalances(netted.program.id))[0]?.approved).toBe(5500);
  });

  it("batch waits for a human; API keys and AI cannot approve", async () => {
    const f = await withCommissions([6000], "approved");
    const [po] = await createPayoutBatch(f.program.id, { type: "ai", id: "run_1" });
    expect(po?.status).toBe("awaiting_approval");
    await expect(approvePayouts(f.program.id, [po!.id], { type: "api_key", id: "key_1" })).rejects.toThrow(
      /signed-in/,
    );
    await expect(approvePayouts(f.program.id, [po!.id], { type: "ai", id: "run" })).rejects.toThrow(
      /signed-in/,
    );
    // no duplicate batch while one is open
    expect(await createPayoutBatch(f.program.id, { type: "system", id: null })).toHaveLength(0);
  });

  it("manual payout: approve locks commissions, mark paid settles them", async () => {
    const f = await withCommissions([6000, 2000], "approved");
    const [po] = await createPayoutBatch(f.program.id, { type: "system", id: null });
    const res = await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    expect(res[0]?.status).toBe("processing");
    const locked = await db().select().from(commission).where(eq(commission.payoutId, po!.id));
    expect(locked).toHaveLength(2);
    await markPaid(f.program.id, po!.id, user(f.user.id), "bank-ref-1");
    const [after] = await db().select().from(payout).where(eq(payout.id, po!.id));
    expect(after).toMatchObject({ status: "paid", amount: 8000, externalId: "bank-ref-1" });
    expect(
      (await db().select().from(commission).where(eq(commission.payoutId, po!.id))).every(
        (c) => c.status === "paid",
      ),
    ).toBe(true);
  });

  it("failed provider payout releases the commissions for a retry", async () => {
    const f = await withCommissions([6000], "approved");
    await db().update(partner).set({ payoutMethod: "stripe" }).where(eq(partner.id, f.partner.id));
    const [po] = await createPayoutBatch(f.program.id, { type: "system", id: null });
    const res = await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    expect(res[0]?.status).toBe("failed");
    expect(
      (await db().select().from(commission).where(eq(commission.partnerId, f.partner.id)))[0]?.payoutId,
    ).toBeNull();
  });

  it("exports CSV with escaping", () => {
    const csv = payoutsCsv([
      {
        invoiceNumber: "OP-1",
        partnerName: 'Pat "P", Ltd',
        partnerEmail: "p@x.test",
        amount: 12345,
        currency: "usd",
        method: "manual",
        status: "paid",
        paidAt: null,
        paypalEmail: null,
      },
    ]);
    expect(csv.split("\n")[1]).toBe('OP-1,"Pat ""P"", Ltd",p@x.test,123.45,USD,manual,paid,,');
  });
});
