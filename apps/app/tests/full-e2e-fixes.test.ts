import { commission, payout } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createId } from "@/lib/id";
import { createCampaign, parseCampaign } from "@/server/campaigns";
import { db } from "@/server/db";
import { rescorePartner } from "@/server/fraud-run";
import { holdCommissions, releaseCommissions } from "@/server/ledger";
import { createLink } from "@/server/partners";
import { createPayoutBatch } from "@/server/payouts";
import { recordLead } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

// Regression tests for bugs found by the full end-to-end run of 2026-11-05.
const user = (id: string) => ({ type: "user" as const, id });

describe("full E2E fixes", () => {
  it("releasing a held manual commission (no hold date) makes it approved again", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const id = createId("com");
    await db().insert(commission).values({
      id,
      programId: f.program.id,
      workspaceId: f.ws.id,
      partnerId: p.id,
      kind: "bonus",
      sourceKey: id,
      amount: 2500,
      currency: "usd",
      status: "approved",
    });
    await holdCommissions(f.program.id, [id], "check", user(f.user.id));
    await releaseCommissions(f.program.id, [id], user(f.user.id));
    const [c] = await db().select().from(commission).where(eq(commission.id, id));
    expect(c?.status).toBe("approved");
  });

  it("re-running fraud checks works when partners share a PayPal email", async () => {
    const f = await fixture();
    const a = await addPartner(f.program.id, f.ws.id, { paypalEmail: "same@pay.test" });
    await addPartner(f.program.id, f.ws.id, { paypalEmail: "SAME@pay.test" });
    const r = await rescorePartner(a.id);
    expect(JSON.stringify(r)).toContain("duplicate_payout_method");
  });

  it("leads are not credited to partners who aren't approved", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id, { status: "pending" });
    expect(
      await recordLead({ programId: f.program.id, email: "x@lead.test", partnerCode: p.code }),
    ).toBeNull();
  });

  it("links must be http or https", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await expect(
      createLink(f.program.id, p.id, { destination: "javascript://acme.test/%0aalert(1)" }),
    ).rejects.toThrow("https");
  });

  it("campaign rules are checked on the server and boosts stop at 5x", async () => {
    const f = await fixture();
    expect(() => parseCampaign("100x commissions this week")).toThrow("5x");
    await expect(
      createCampaign(
        f.program.id,
        {
          name: "x",
          description: "x",
          rule: { kind: "boost", multiplier: 100 },
          startsAt: new Date(),
          endsAt: null,
        },
        user(f.user.id),
      ),
    ).rejects.toThrow();
  });

  it("concurrent batch creation makes one payout per partner", async () => {
    const f = await fixture({ minPayout: 1 });
    const p = await addPartner(f.program.id, f.ws.id);
    const id = createId("com");
    await db().insert(commission).values({
      id,
      programId: f.program.id,
      workspaceId: f.ws.id,
      partnerId: p.id,
      kind: "sale",
      sourceKey: id,
      amount: 9000,
      currency: "usd",
      status: "approved",
    });
    const sys = { type: "system" as const, id: null };
    await Promise.all([1, 2, 3].map(() => createPayoutBatch(f.program.id, sys)));
    const rows = await db().select().from(payout).where(eq(payout.programId, f.program.id));
    expect(rows).toHaveLength(1);
  });
});
