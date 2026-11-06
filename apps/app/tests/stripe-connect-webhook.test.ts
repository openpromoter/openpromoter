import { billingConnection, referral } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/stripe-connect/route";
import { createId } from "@/lib/id";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { recordClick } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

const SECRET = "whsec_connect_test";
env.STRIPE_CONNECT_WEBHOOK_SECRET = SECRET;

function send(evt: object, secret = SECRET) {
  const payload = JSON.stringify(evt);
  const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return POST(
    new Request("http://x/api/webhooks/stripe-connect", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": sig },
    }),
  );
}

const checkout = (account: string, clickId: string, cus: string) => ({
  id: `evt_${crypto.randomUUID().slice(0, 12)}`,
  object: "event",
  type: "checkout.session.completed",
  account,
  livemode: false,
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: `cs_${cus}`,
      object: "checkout.session",
      customer: cus,
      client_reference_id: clickId,
      customer_details: { email: `${cus}@buyer.test` },
      metadata: {},
    },
  },
});

describe("Connect webhook (founders who used Connect with Stripe)", () => {
  it("routes a connected account's event to its workspace", async () => {
    const f = await fixture();
    const acct = `acct_${crypto.randomUUID().slice(0, 12)}`;
    await db()
      .insert(billingConnection)
      .values({
        id: createId("bcn"),
        workspaceId: f.ws.id,
        provider: "stripe",
        mode: "oauth",
        accountId: acct,
        livemode: false,
      });
    const p = await addPartner(f.program.id, f.ws.id);
    const click = await recordClick({
      programId: f.program.id,
      code: p.code,
      landingUrl: `https://acme.test/?via=${p.code}`,
      userAgent: "Mozilla/5.0",
      ip: "1.2.3.4",
    });
    const cus = `cus_${crypto.randomUUID().slice(0, 12)}`;
    const res = await send(checkout(acct, click!.clickId, cus));
    expect(res.status).toBe(200);
    const [r] = await db().select().from(referral).where(eq(referral.externalCustomerId, cus));
    expect(r?.partnerId).toBe(p.id);
  });

  it("ignores unknown accounts and rejects bad signatures", async () => {
    expect(await (await send(checkout("acct_unknown", "clk_x", "cus_x"))).json()).toMatchObject({
      ignored: "unknown account",
    });
    expect((await send(checkout("acct_unknown", "clk_x", "cus_x"), "whsec_wrong")).status).toBe(400);
  });
});
