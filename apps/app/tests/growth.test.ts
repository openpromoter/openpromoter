import { agentAction, apiKey, commission, partner, partnerGroup } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sha256 } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { applyAction, runAutopilot, undoAction } from "@/server/ai/autopilot";
import { overview, topPartners } from "@/server/analytics";
import { authenticate, match, ROUTES } from "@/server/api";
import { createCampaign, evaluateBounties, evaluateTiers } from "@/server/campaigns";
import { db } from "@/server/db";
import { recordClick, recordLead } from "@/server/tracking";
import { addPartner, fixture } from "./helpers";

const user = (id: string) => ({ type: "user" as const, id });

describe("autopilot", () => {
  it("suggests, applies with undo, never pays", async () => {
    const f = await fixture();
    const risky = await addPartner(f.program.id, f.ws.id, { riskScore: 90 });
    const res = await runAutopilot(f.program.id);
    expect(res.created).toBeGreaterThan(0);
    const [pause] = await db().select().from(agentAction).where(eq(agentAction.targetId, risky.id));
    expect(pause?.kind).toBe("pause_partner");
    await applyAction(f.program.id, pause!.id, user(f.user.id));
    expect((await db().select().from(partner).where(eq(partner.id, risky.id)))[0]?.status).toBe("paused");
    await undoAction(f.program.id, pause!.id, user(f.user.id));
    expect((await db().select().from(partner).where(eq(partner.id, risky.id)))[0]?.status).toBe("approved");
    // a second run in the same week does not repeat the suggestion
    const again = await runAutopilot(f.program.id);
    expect((await db().select().from(agentAction).where(eq(agentAction.targetId, risky.id))).length).toBe(1);
    void again;
  });

  it("act mode applies safe kinds only", async () => {
    const f = await fixture({ autopilotMode: "act" });
    await addPartner(f.program.id, f.ws.id, { riskScore: 95 });
    const r = await runAutopilot(f.program.id);
    expect(r.applied).toBeGreaterThan(0);
    const rows = await db().select().from(agentAction).where(eq(agentAction.programId, f.program.id));
    for (const a of rows) if (a.kind === "prepare_payouts") expect(a.status).toBe("suggested");
  });
});

describe("tiers, bounties, analytics", () => {
  it("promotes partners into higher tiers by revenue", async () => {
    const f = await fixture();
    const [pro] = await db()
      .insert(partnerGroup)
      .values({
        id: createId("grp"),
        programId: f.program.id,
        name: "Pro",
        rank: 1,
        commissionType: "percent",
        commissionValue: 4000,
        promoteAtRevenue: 10000,
      })
      .returning();
    const p = await addPartner(f.program.id, f.ws.id, { groupId: f.group.id });
    await db()
      .insert(commission)
      .values({
        id: createId("com"),
        programId: f.program.id,
        workspaceId: f.ws.id,
        partnerId: p.id,
        kind: "sale",
        sourceKey: createId("com"),
        saleAmount: 12000,
        amount: 3600,
        currency: "usd",
      });
    expect((await evaluateTiers(f.program.id, p.id))?.id).toBe(pro!.id);
  });

  it("pays a signup bounty once per referral", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await createCampaign(
      f.program.id,
      {
        name: "Signup bounty",
        description: "",
        rule: { kind: "bounty", trigger: "signup", reward: 500 },
        startsAt: new Date(Date.now() - 1000),
        endsAt: null,
      },
      user(f.user.id),
    );
    const c = await recordClick({ programId: f.program.id, code: p.code, userAgent: "Mozilla/5.0" });
    await recordLead({ programId: f.program.id, email: "lead@x.test", clickId: c!.clickId });
    await evaluateBounties(f.program.id, p.id, "signup");
    await evaluateBounties(f.program.id, p.id, "signup");
    const rows = await db().select().from(commission).where(eq(commission.partnerId, p.id));
    expect(rows.filter((r) => r.kind === "bounty")).toHaveLength(1);
  });

  it("ranks top partners by revenue and computes totals", async () => {
    const f = await fixture();
    const a = await addPartner(f.program.id, f.ws.id, { name: "Small" });
    const b = await addPartner(f.program.id, f.ws.id, { name: "Big" });
    await addPartner(f.program.id, f.ws.id, { name: "Zero", status: "rejected" });
    for (const [p, amt] of [
      [a, 1000],
      [b, 9000],
    ] as const) {
      await db()
        .insert(commission)
        .values({
          id: createId("com"),
          programId: f.program.id,
          workspaceId: f.ws.id,
          partnerId: p.id,
          kind: "sale",
          sourceKey: createId("com"),
          saleAmount: amt,
          amount: amt / 10,
          currency: "usd",
        });
    }
    const r = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 1000) };
    const top = await topPartners(f.program.id, r, 2);
    expect(top.map((t) => t.name)).toEqual(["Big", "Small"]);
    expect((await overview(f.program.id, r)).revenue).toBe(10000);
  });
});

describe("REST API", () => {
  it("routes, scopes and tenant isolation", async () => {
    expect(match("GET", "/programs/prg_1/partners")?.params).toEqual({ programId: "prg_1" });
    expect(match("DELETE", "/programs")).toBeNull();
    expect(ROUTES.some((r) => r.scope === "payouts:request" && r.method === "POST")).toBe(true);
    const a = await fixture();
    const b = await fixture();
    const raw = `op_sk_${createId("key")}`;
    await db()
      .insert(apiKey)
      .values({
        id: createId("key"),
        workspaceId: a.ws.id,
        name: "t",
        prefix: raw.slice(0, 12),
        hash: sha256(raw),
        scopes: ["read"],
      });
    const ctx = await authenticate(new Request("http://x", { headers: { authorization: `Bearer ${raw}` } }));
    const list = match("GET", `/programs/${b.program.id}/partners`)!;
    await expect(
      list.route.handler(ctx, { params: list.params, query: { limit: 10 }, body: {} }),
    ).rejects.toMatchObject({ status: 404 });
    const own = match("GET", `/programs/${a.program.id}/partners`)!;
    await expect(
      own.route.handler(ctx, { params: own.params, query: { limit: 10 }, body: {} }),
    ).resolves.toMatchObject({ data: [] });
    await expect(
      authenticate(new Request("http://x", { headers: { authorization: "Bearer nope" } })),
    ).rejects.toMatchObject({ status: 401 });
  });
});
