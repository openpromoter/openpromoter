import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  OpenPromoter,
  OpenPromoterError,
  readReferralCookie,
  stripeCheckoutParams,
  trackSignup,
  verifyWebhook,
} from "../src/index";

describe("sdk", () => {
  it("sends authenticated requests and surfaces API errors", async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "forbidden", message: "needs scope" } }), {
          status: 403,
        }),
    );
    const op = new OpenPromoter({
      apiKey: "op_sk_x",
      baseUrl: "http://localhost:3000/",
      fetch: f as unknown as typeof fetch,
    });
    await expect(op.partners.list("prg_1", { status: "approved" })).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/v1/programs/prg_1/partners?status=approved");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer op_sk_x");
  });
  it("verifies webhook signatures", () => {
    const body = JSON.stringify({
      id: "whd_1",
      type: "commission.created",
      created: 1,
      data: { amount: 100 },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac("sha256", "whsec").update(`${t}.${body}`).digest("hex")}`;
    expect(verifyWebhook(body, sig, "whsec").type).toBe("commission.created");
    expect(() => verifyWebhook(body, sig, "wrong")).toThrow(OpenPromoterError);
    expect(() => verifyWebhook(body, `t=1,v1=abc`, "whsec")).toThrow(/tolerance/);
  });
  it("reads the op_ref cookie and builds Stripe params", () => {
    const ref = readReferralCookie(
      `a=1; op_ref=${encodeURIComponent(JSON.stringify({ c: "clk_1", v: "vis_1", p: "maya" }))}`,
    );
    expect(ref).toEqual({ clickId: "clk_1", visitorId: "vis_1", code: "maya" });
    expect(stripeCheckoutParams(ref).client_reference_id).toBe("clk_1");
    expect(stripeCheckoutParams(ref).discounts).toBeUndefined();
    // the referred customer's coupon comes from server config and only applies to a referral
    expect(stripeCheckoutParams(ref, { coupon: "REFER20" }).discounts).toEqual([{ coupon: "REFER20" }]);
    expect(stripeCheckoutParams(null, { coupon: "REFER20" })).toEqual({});
    expect(readReferralCookie("x=1")).toBeNull();
  });
  it("trackSignup never throws", async () => {
    const op = new OpenPromoter({
      apiKey: "k",
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    await expect(trackSignup(op, { programId: "p", email: "a@b.c" })).resolves.toMatchObject({
      attributed: false,
    });
  });
});
