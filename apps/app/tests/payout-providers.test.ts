import { billingConnection, commission, payout } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { toMajor } from "@/lib/money";
import { db } from "@/server/db";
import { balances, createManualCommission, reverseCommissions } from "@/server/ledger";
import { approvePayouts, createPayoutBatch, markPaid, reconcilePayouts } from "@/server/payouts";
import { addPartner, fixture } from "./helpers";

// Regression tests for the payout audit of 2026-11-05. Provider calls go to a stubbed fetch.
const user = (id: string) => ({ type: "user" as const, id });
const sys = { type: "system" as const, id: null };
type F = Awaited<ReturnType<typeof fixture>>;

async function com(f: F, partnerId: string, amount: number, currency = "usd") {
  const id = createId("com");
  await db().insert(commission).values({
    id,
    programId: f.program.id,
    workspaceId: f.ws.id,
    partnerId,
    kind: "sale",
    sourceKey: id,
    amount,
    currency,
    status: "approved",
  });
  return id;
}
async function connect(wsId: string, provider: "paypal" | "wise", secret: object) {
  await db()
    .insert(billingConnection)
    .values({
      id: createId("bcn"),
      workspaceId: wsId,
      provider,
      mode: "api_key",
      secretEnc: encrypt(JSON.stringify(secret)),
    });
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const get = async (id: string) => (await db().select().from(payout).where(eq(payout.id, id)))[0]!;
/** Reconcile runs on payouts approved over 2 minutes ago. */
const later = () => reconcilePayouts(new Date(Date.now() + 5 * 60_000));

afterEach(() => vi.unstubAllGlobals());

describe("money units", () => {
  it("formats zero and three decimal currencies", () => {
    expect(toMajor(1050, "usd")).toBe("10.50");
    expect(toMajor(10000, "jpy")).toBe("10000");
    expect(toMajor(1500, "bhd")).toBe("1.500");
  });
});

describe("PayPal", () => {
  async function setup(currency = "usd", amount = 6000) {
    const f = await fixture({ currency, minPayout: 1 });
    const a = await addPartner(f.program.id, f.ws.id, {
      payoutMethod: "paypal",
      paypalEmail: "x@y.test",
      country: "DE",
    });
    await connect(f.ws.id, "paypal", { clientId: "c", clientSecret: "s", sandbox: true });
    await com(f, a.id, amount, currency);
    return { f, a };
  }

  it("keeps a PENDING batch processing, then settles on SUCCESS", async () => {
    const { f } = await setup();
    let status = "PENDING";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/oauth2/token")) return json(200, { access_token: "t" });
        if (init?.method === "POST")
          return json(201, { batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } });
        return json(200, { batch_header: { batch_status: status }, items: [{ transaction_status: status }] });
      }),
    );
    const [po] = await createPayoutBatch(f.program.id, sys);
    const [r] = await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    expect(r?.status).toBe("processing");
    expect((await get(po!.id)).externalId).toBe("B1");
    await later();
    expect((await get(po!.id)).status).toBe("processing");
    status = "SUCCESS";
    await later();
    expect((await get(po!.id)).status).toBe("paid");
  });

  it("fails a RETURNED item and frees the commissions", async () => {
    const { f } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/oauth2/token")) return json(200, { access_token: "t" });
        if (init?.method === "POST") return json(201, { batch_header: { payout_batch_id: "B1" } });
        return json(200, {
          batch_header: { batch_status: "SUCCESS" },
          items: [{ transaction_status: "RETURNED" }],
        });
      }),
    );
    const [po] = await createPayoutBatch(f.program.id, sys);
    await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    await later();
    expect((await get(po!.id)).status).toBe("failed");
    expect((await balances(f.program.id))[0]?.approved).toBe(6000);
  });

  it("sends JPY in whole yen", async () => {
    const { f } = await setup("jpy", 10000);
    const bodies: { items: { amount: unknown }[] }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/oauth2/token")) return json(200, { access_token: "t" });
        bodies.push(JSON.parse(String(init?.body)));
        return json(201, { batch_header: { payout_batch_id: "B1" } });
      }),
    );
    const [po] = await createPayoutBatch(f.program.id, sys);
    await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    expect(bodies[0]?.items[0]?.amount).toEqual({ value: "10000", currency: "JPY" });
  });

  it("refuses currencies PayPal does not pay out", async () => {
    const { f } = await setup("krw", 10000);
    vi.stubGlobal("fetch", vi.fn());
    const [po] = await createPayoutBatch(f.program.id, sys);
    const [r] = await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    expect(r?.status).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a timeout keeps the payout locked and the resend reuses the same sender_batch_id", async () => {
    const { f } = await setup();
    const ids: string[] = [];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/oauth2/token")) return json(200, { access_token: "t" });
        if (init?.method !== "POST") return json(200, { items: [{ transaction_status: "PENDING" }] });
        ids.push(JSON.parse(String(init.body)).sender_batch_header.sender_batch_id);
        if (n++ === 0) throw new TypeError("fetch failed");
        return json(400, {
          name: "USER_BUSINESS_ERROR",
          details: [{ issue: "SENDER_BATCH_ID_ALREADY_USED" }],
          links: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/B9", rel: "self" }],
        });
      }),
    );
    const [po] = await createPayoutBatch(f.program.id, sys);
    const [r] = await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    expect(r?.status).toBe("processing");
    expect((await balances(f.program.id))[0]?.approved).toBe(0); // still locked, not payable twice
    await later();
    expect(ids).toEqual([po!.id, po!.id]);
    const after = await get(po!.id);
    expect(after.status).toBe("processing");
    expect(after.externalId).toBe("B9");
  });
});

describe("Wise", () => {
  async function setup() {
    const f = await fixture({ minPayout: 1 });
    const a = await addPartner(f.program.id, f.ws.id, {
      payoutMethod: "wise",
      wiseEmail: "x@y.test",
      country: "DE",
    });
    await connect(f.ws.id, "wise", { token: "tokentoken", profileId: "1" });
    await com(f, a.id, 6000);
    return f;
  }
  const wise = (fund: () => Response, status = "processing") =>
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/quotes")) return json(200, { id: "q1" });
      if (url.endsWith("/v1/accounts")) return json(200, { id: 9 });
      if (url.endsWith("/v1/transfers")) return json(200, { id: 77 });
      if (url.endsWith("/payments")) return fund();
      if (url.endsWith("/cancel")) return json(200, { id: 77, status: "cancelled" });
      if (!init?.method) return json(200, { id: 77, status });
      return json(404, {});
    });

  it("a REJECTED funding fails the payout and cancels the transfer", async () => {
    const f = await setup();
    const fn = wise(() => json(201, { status: "REJECTED", errorCode: "balance.insufficient-funds" }));
    vi.stubGlobal("fetch", fn);
    const [po] = await createPayoutBatch(f.program.id, sys);
    const [r] = await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    expect(r?.status).toBe("failed");
    expect(fn.mock.calls.some(([u]) => String(u).endsWith("/v1/transfers/77/cancel"))).toBe(true);
  });

  it("an SCA 403 keeps the transfer id and waits until Wise sends it", async () => {
    const f = await setup();
    let status = "incoming_payment_waiting";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        !init?.method && url.endsWith("/v1/transfers/77")
          ? json(200, { id: 77, status })
          : wise(() => json(403, { error: "SCA required" }))(url, init),
      ),
    );
    const [po] = await createPayoutBatch(f.program.id, sys);
    const [r] = await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    expect(r?.status).toBe("processing");
    const mid = await get(po!.id);
    expect(mid.externalId).toBe("77");
    expect(mid.failureReason).toContain("Wise app");
    expect((await balances(f.program.id))[0]?.approved).toBe(0);
    await later();
    expect((await get(po!.id)).status).toBe("processing");
    status = "outgoing_payment_sent";
    await later();
    expect((await get(po!.id)).status).toBe("paid");
  });
});

describe("ledger while a payout is sending", () => {
  it("numbers invoices uniquely", async () => {
    const f = await fixture();
    const a = await addPartner(f.program.id, f.ws.id, { payoutMethod: "manual" });
    const b = await addPartner(f.program.id, f.ws.id, { payoutMethod: "manual" });
    await com(f, a.id, 6000);
    await com(f, b.id, 7000);
    const batch = await createPayoutBatch(f.program.id, sys);
    await approvePayouts(
      f.program.id,
      batch.map((p) => p.id),
      user(f.user.id),
    );
    const rows = await db().select().from(payout).where(eq(payout.programId, f.program.id));
    expect(rows.map((r) => r.invoiceNumber).sort()).toEqual(["OP-00001", "OP-00002"]);
  });

  it("a locked commission can't be reversed; marking paid leaves the rest alone", async () => {
    const f = await fixture();
    const a = await addPartner(f.program.id, f.ws.id, { payoutMethod: "manual" });
    await com(f, a.id, 6000);
    const second = await com(f, a.id, 4000);
    const [po] = await createPayoutBatch(f.program.id, sys);
    await approvePayouts(f.program.id, [po!.id], user(f.user.id));
    expect(await reverseCommissions(f.program.id, [second], "refund", user(f.user.id))).toBe(0);
    await markPaid(f.program.id, po!.id, user(f.user.id), "bank");
    expect((await get(po!.id)).amount).toBe(10000);
    const [c] = await db().select().from(commission).where(eq(commission.id, second));
    expect(c?.status).toBe("paid");
  });

  it("the no-2FA limit applies to the amount actually locked", async () => {
    const f = await fixture();
    const a = await addPartner(f.program.id, f.ws.id, { payoutMethod: "manual" });
    await com(f, a.id, 6000);
    const [po] = await createPayoutBatch(f.program.id, sys);
    await createManualCommission(
      f.program.id,
      { partnerId: a.id, amount: 5_000_000, description: "bonus" },
      user(f.user.id),
    );
    await expect(
      approvePayouts(f.program.id, [po!.id], user(f.user.id), { limit: f.program.payoutTwoFactorAbove }),
    ).rejects.toThrow("2FA_CODE_REQUIRED");
    const after = await get(po!.id);
    expect(after.status).toBe("awaiting_approval");
  });

  it("test-mode commissions get their own manual payout", async () => {
    const f = await fixture();
    const a = await addPartner(f.program.id, f.ws.id, { payoutMethod: "paypal", paypalEmail: "x@y.test" });
    await com(f, a.id, 6000);
    const t = await com(f, a.id, 7000);
    await db().update(commission).set({ test: true }).where(eq(commission.id, t));
    const batch = await createPayoutBatch(f.program.id, sys);
    const live = batch.find((b) => !b.test);
    const test = batch.find((b) => b.test);
    expect(live?.amount).toBe(6000);
    expect(live?.method).toBe("paypal");
    expect(test?.amount).toBe(7000);
    expect(test?.method).toBe("manual");
    vi.stubGlobal("fetch", vi.fn());
    await approvePayouts(f.program.id, [test!.id], user(f.user.id));
    expect(fetch).not.toHaveBeenCalled();
    expect((await get(test!.id)).amount).toBe(7000);
  });
});
