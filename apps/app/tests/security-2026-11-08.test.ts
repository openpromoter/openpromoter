import { campaign, commission } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createId } from "@/lib/id";
import { evaluateBounties } from "@/server/campaigns";
import { db } from "@/server/db";
import { autoApproveDecision } from "@/server/partners";
import { recordLead } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

// Regression tests for the security review of 2026-11-08.
describe("security review 2026-11-08", () => {
  it("a browser-reported lead holds its lead commission; an API lead does not", async () => {
    const f = await fixture({ leadCommission: 500 });
    const p = await addPartner(f.program.id, f.ws.id);
    const fromBrowser = await recordLead({
      programId: f.program.id,
      email: "fake@lead.test",
      partnerCode: p.code,
      browser: true,
    });
    const fromApi = await recordLead({
      programId: f.program.id,
      email: "real@lead.test",
      partnerCode: p.code,
    });
    const rows = await db().select().from(commission).where(eq(commission.partnerId, p.id));
    const by = (refId: string) => rows.find((r) => r.referralId === refId)!;
    expect(by(fromBrowser!.id).status).toBe("held");
    expect(by(fromBrowser!.id).heldReason).toMatch(/browser script/);
    expect(by(fromApi!.id).status).toBe("pending");
  });

  it("a signup bounty from a browser lead is held", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await db()
      .insert(campaign)
      .values({
        id: createId("cmp"),
        programId: f.program.id,
        name: "Signup bounty",
        status: "active",
        startsAt: new Date(Date.now() - 60_000),
        rule: { kind: "bounty", trigger: "signup", reward: 300 },
      } as typeof campaign.$inferInsert);
    await recordLead({ programId: f.program.id, email: "b@lead.test", partnerCode: p.code, browser: true });
    await evaluateBounties(f.program.id, p.id, "signup", true);
    const mine = (await db().select().from(commission).where(eq(commission.partnerId, p.id))).find(
      (c) => c.kind === "bounty",
    );
    expect(mine?.status).toBe("held");
  });

  it("the email-domain allow list needs a confirmed email", () => {
    const prog = {
      visibility: "public" as const,
      autoApprove: {
        enabled: true,
        maxRiskScore: 100,
        requireWebsite: false,
        blockedCountries: [],
        allowedEmailDomains: ["acme.com"],
      },
    };
    const base = { email: "anyone@acme.com", riskScore: 0, invited: false };
    expect(autoApproveDecision(prog, { ...base, emailVerified: false }).approve).toBe(false);
    expect(autoApproveDecision(prog, { ...base, emailVerified: true }).approve).toBe(true);
    // founder-added and API partners carry no flag and keep working
    expect(autoApproveDecision(prog, base).approve).toBe(true);
  });
});
