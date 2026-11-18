import { campaign, commission, referral } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";
import { toCsv } from "@/lib/csv";
import { normalizeDodo } from "@/server/billing/dodo";
import type { Json } from "@/server/billing/types";
import { evaluateBounties } from "@/server/campaigns";
import { db } from "@/server/db";
import { ingest } from "@/server/ingest";
import { approveCommissions } from "@/server/ledger";
import { canCreateWorkspace } from "@/server/setup";
import { recordClick, recordLead } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

const ENV = ["TRUSTED_IP_HEADER", "PEER_IP_HEADER", "TRUSTED_PROXY_CIDRS", "WORKSPACE_CREATORS"] as const;
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

const req = (h: Record<string, string>) => new Request("http://x", { headers: h });

describe("client IP behind Cloudflare with the origin also reachable directly", () => {
  it("believes cf-connecting-ip only when the connecting peer is Cloudflare", () => {
    process.env.TRUSTED_IP_HEADER = "cf-connecting-ip";
    process.env.PEER_IP_HEADER = "x-real-ip";
    // through Cloudflare: Railway's edge writes the Cloudflare address into x-real-ip
    expect(clientIp(req({ "x-real-ip": "172.70.1.2", "cf-connecting-ip": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIp(req({ "x-real-ip": "2606:4700:10::1", "cf-connecting-ip": "203.0.113.8" }))).toBe(
      "203.0.113.8",
    );
    // straight to the Railway domain: the forged header is ignored, the real peer is used
    expect(clientIp(req({ "x-real-ip": "49.47.198.83", "cf-connecting-ip": "1.2.3.4" }))).toBe(
      "49.47.198.83",
    );
    // a Cloudflare peer with junk in the header falls back to the peer
    expect(clientIp(req({ "x-real-ip": "172.70.1.2", "cf-connecting-ip": "not-an-ip" }))).toBe("172.70.1.2");
  });

  it("TRUSTED_PROXY_CIDRS replaces the Cloudflare list, and the old modes still work", () => {
    process.env.TRUSTED_IP_HEADER = "fly-client-ip";
    process.env.PEER_IP_HEADER = "x-real-ip";
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    expect(clientIp(req({ "x-real-ip": "10.1.2.3", "fly-client-ip": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientIp(req({ "x-real-ip": "8.8.8.8", "fly-client-ip": "198.51.100.1" }))).toBe("8.8.8.8");
    delete process.env.PEER_IP_HEADER;
    expect(clientIp(req({ "fly-client-ip": "198.51.100.1" }))).toBe("198.51.100.1");
    delete process.env.TRUSTED_IP_HEADER;
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
  });
});

describe("TRUSTED_PROXY_CIDRS typos", () => {
  it("skip bad entries instead of trusting everyone or throwing", () => {
    process.env.TRUSTED_IP_HEADER = "cf-connecting-ip";
    process.env.PEER_IP_HEADER = "x-real-ip";
    for (const bad of ["10.0.0.0/", "10.0.0.0/0", "10.0.0.0/33", "10.0.0.0/ab", "1.2.3.4/8/9"]) {
      process.env.TRUSTED_PROXY_CIDRS = bad;
      expect(clientIp(req({ "x-real-ip": "8.8.8.8", "cf-connecting-ip": "1.2.3.4" }))).toBe("8.8.8.8");
    }
  });
});

describe("CSV formula guard", () => {
  it("quotes a bare carriage return so it can't start a new row", () => {
    const csv = toCsv([{ name: "Bob\r=HYPERLINK(1)" }]);
    expect(csv.split("\n")[1]).toBe('"Bob\r=HYPERLINK(1)"');
  });
});

describe("workspace creation allowlist", () => {
  it("is open when unset and limited to the listed emails when set", () => {
    expect(canCreateWorkspace("anyone@x.test", false)).toBe(true);
    process.env.WORKSPACE_CREATORS = " Owner@Acme.test , ops@acme.test";
    expect(canCreateWorkspace("owner@acme.test", true)).toBe(true);
    expect(canCreateWorkspace("stranger@x.test", true)).toBe(false);
    // someone who registered the listed address without owning it never verified it
    expect(canCreateWorkspace("owner@acme.test", false)).toBe(false);
  });
});

let n = 0;
const send = (wsId: string, body: Json) =>
  ingest(wsId, "dodo", normalizeDodo({ ...body, __id: `sec_${++n}_${Math.random()}` }, false));
const paid = (customer: string, paymentId: string, email: string, metadata: Json = {}) => ({
  type: "payment.succeeded",
  data: {
    payment_id: paymentId,
    customer: { customer_id: customer, email, name: "Buyer" },
    total_amount: 10000,
    tax: 0,
    currency: "USD",
    metadata,
    created_at: new Date().toISOString(),
  },
});

async function partnerWithClick() {
  const f = await fixture();
  const p = await addPartner(f.program.id, f.ws.id);
  const click = await recordClick({
    programId: f.program.id,
    code: p.code,
    landingUrl: `https://acme.test/?via=${p.code}`,
    userAgent: "Mozilla/5.0",
    ip: "1.2.3.4",
  });
  return { f, p, click: click! };
}

describe("browser-reported signups", () => {
  it("a partner pre-claiming an email gets a held sale, renewals included", async () => {
    const { f, p, click } = await partnerWithClick();
    const lead = await recordLead({
      programId: f.program.id,
      email: "victim@customer.test",
      clickId: click.clickId,
      browser: true,
      ip: "1.2.3.4",
    });
    expect(lead?.browserLead).toBe(true);
    // the victim later pays on their own: no click, visitor or code in the checkout
    await send(f.ws.id, paid("cus_v", "pay_v1", "victim@customer.test"));
    await send(f.ws.id, paid("cus_v", "pay_v2", "victim@customer.test"));
    const sales = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "sale")));
    expect(sales).toHaveLength(2);
    expect(sales.every((c) => c.status === "held")).toBe(true);

    // the founder approves it: the customer is confirmed, so the next renewal is not held
    await approveCommissions(f.program.id, [sales[0]!.id], { type: "user", id: "founder" } as never);
    await send(f.ws.id, paid("cus_v", "pay_v3", "victim@customer.test"));
    const [third] = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, p.id), eq(commission.sourceKey, "dodo:pay_v3")));
    expect(third?.status).toBe("pending");
    const [confirmed] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_v"));
    expect(confirmed).toMatchObject({ browserLead: false });
    expect(confirmed?.browserConfirmedAt).toBeInstanceOf(Date);
  });

  it("a checkout carrying the lead's own click confirms it, so sales are not held", async () => {
    const { f, p, click } = await partnerWithClick();
    await recordLead({
      programId: f.program.id,
      email: "real@customer.test",
      clickId: click.clickId,
      browser: true,
      ip: "1.2.3.4",
    });
    await send(f.ws.id, paid("cus_r", "pay_r1", "real@customer.test", { op_click: click.clickId }));
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_r"));
    expect(r?.browserLead).toBe(false);
    const [sale] = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "sale")));
    expect(sale?.status).toBe("pending");
  });
});

describe("refunds and bounties", () => {
  it("the same refund reported twice is booked once", async () => {
    const { f, p, click } = await partnerWithClick();
    await send(f.ws.id, paid("cus_i", "pay_i", "i@customer.test", { op_click: click.clickId }));
    const partial = {
      type: "refund.succeeded",
      data: { refund_id: "rfd_x", payment_id: "pay_i", amount: 2500 },
    };
    await send(f.ws.id, partial);
    await send(f.ws.id, partial);
    const adj = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "adjustment")));
    expect(adj).toHaveLength(1);
  });

  it("a first-sale bounty follows its sale: held with it and reversed by its refund", async () => {
    const { f, p, click } = await partnerWithClick();
    await db()
      .insert(campaign)
      .values({
        id: `cmp_${Math.random().toString(36).slice(2)}`,
        programId: f.program.id,
        name: "First sale",
        status: "active",
        startsAt: new Date(Date.now() - 86_400_000),
        rule: { kind: "bounty", trigger: "first_sale", reward: 5000 } as never,
      });
    await send(f.ws.id, paid("cus_b", "pay_b", "b@customer.test", { op_click: click.clickId }));
    const [sale] = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "sale")));
    // the worker runs this job after the payment
    await evaluateBounties(f.program.id, p.id, "first_sale", false, { id: sale!.id });
    const bounty = async () =>
      (
        await db()
          .select()
          .from(commission)
          .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "bounty")))
      )[0];
    expect(await bounty()).toMatchObject({ status: "pending", parentId: sale!.id, amount: 5000 });

    await send(f.ws.id, {
      type: "refund.succeeded",
      data: { refund_id: "rfd_b", payment_id: "pay_b", amount: 10000, is_partial: false },
    });
    expect((await bounty())?.status).toBe("reversed");
  });

  it("a chargeback holds the first-sale bounty with its sale, and winning it releases both", async () => {
    const { f, p, click } = await partnerWithClick();
    await db()
      .insert(campaign)
      .values({
        id: `cmp_${Math.random().toString(36).slice(2)}`,
        programId: f.program.id,
        name: "First sale",
        status: "active",
        startsAt: new Date(Date.now() - 86_400_000),
        rule: { kind: "bounty", trigger: "first_sale", reward: 5000 } as never,
      });
    await send(f.ws.id, paid("cus_d", "pay_d", "d@customer.test", { op_click: click.clickId }));
    const [sale] = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "sale")));
    await evaluateBounties(f.program.id, p.id, "first_sale", false, { id: sale!.id });
    const bounty = async () =>
      (
        await db()
          .select()
          .from(commission)
          .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "bounty")))
      )[0];
    const dispute = (status: string) =>
      send(f.ws.id, {
        type: `dispute.${status}`,
        data: { dispute_id: "dsp_1", payment_id: "pay_d", dispute_status: `dispute_${status}` },
      });
    await dispute("opened");
    expect((await bounty())?.status).toBe("held");
    await dispute("won");
    expect((await bounty())?.status).toBe("pending");
  });

  it("no bounty for a sale already reversed when the job runs", async () => {
    const { f, p, click } = await partnerWithClick();
    await db()
      .insert(campaign)
      .values({
        id: `cmp_${Math.random().toString(36).slice(2)}`,
        programId: f.program.id,
        name: "First sale",
        status: "active",
        startsAt: new Date(Date.now() - 86_400_000),
        rule: { kind: "bounty", trigger: "first_sale", reward: 5000 } as never,
      });
    await send(f.ws.id, paid("cus_c", "pay_c", "c@customer.test", { op_click: click.clickId }));
    await send(f.ws.id, {
      type: "refund.succeeded",
      data: { refund_id: "rfd_c", payment_id: "pay_c", amount: 10000, is_partial: false },
    });
    const [sale] = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "sale")));
    await evaluateBounties(f.program.id, p.id, "first_sale", false, { id: sale!.id });
    const bounties = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, p.id), eq(commission.kind, "bounty")));
    expect(bounties).toHaveLength(0);
  });
});
