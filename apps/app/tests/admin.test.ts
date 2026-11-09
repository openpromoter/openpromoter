import { workspace } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// The owner's admin view: who may open it, and what it says about each workspace.
vi.mock("@/server/env", async (orig) => {
  const m = await orig<typeof import("@/server/env")>();
  return { ...m, env: { ...m.env, ADMIN_EMAILS: " Owner@Example.test , second@example.test" } };
});

// admin.ts reaches auth.ts, which builds its adapter on import: load it after setup.ts set the test database
const admin = () => import("@/server/admin");
const { db } = await import("@/server/db");
const { fixture } = await import("./helpers");

describe("admin", () => {
  it("lets in only verified emails from ADMIN_EMAILS", async () => {
    const { isAdmin } = await admin();
    expect(isAdmin({ email: "owner@example.test", emailVerified: true })).toBe(true);
    expect(isAdmin({ email: "OWNER@example.test", emailVerified: true })).toBe(true);
    expect(isAdmin({ email: "owner@example.test", emailVerified: false })).toBe(false);
    expect(isAdmin({ email: "someone@example.test", emailVerified: true })).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });

  it("flags a failing payment and counts the setup steps", async () => {
    const { adminWorkspaces, attention } = await admin();
    const f = await fixture();
    await db()
      .update(workspace)
      .set({ plan: "starter", billingStatus: "past_due" })
      .where(eq(workspace.id, f.ws.id));
    const w = (await adminWorkspaces()).find((r) => r.id === f.ws.id)!;
    expect(w.paying).toBe(true);
    expect(w.mrr).toBe(2900);
    expect(w.steps.program).toBe(true);
    expect(w.steps.paying).toBe(true);
    expect(w.steps.tracking).toBe(false);
    expect(attention(w).map((a) => a.text)).toContain("Payment failing on Starter");
  });

  it("an ended plan is not paying and an old workspace without tracking is stuck", async () => {
    const { adminWorkspaces, attention } = await admin();
    const f = await fixture();
    await db()
      .update(workspace)
      .set({ plan: "free", billingStatus: "canceled", createdAt: new Date(Date.now() - 5 * 86_400_000) })
      .where(eq(workspace.id, f.ws.id));
    const w = (await adminWorkspaces()).find((r) => r.id === f.ws.id)!;
    expect(w.paying).toBe(false);
    expect(w.mrr).toBe(0);
    expect(attention(w).map((a) => a.text)).toEqual(["Stuck before tracking"]);
  });

  it("a workspace's page reads only that workspace, and the overview reuses its figures", async () => {
    const { adminWorkspaces, adminWorkspacesCached } = await admin();
    const a = await fixture();
    await fixture();
    const one = await adminWorkspaces(a.ws.id);
    expect(one.map((w) => w.id)).toEqual([a.ws.id]);
    const first = await adminWorkspacesCached(true);
    expect((await adminWorkspacesCached()).at).toBe(first.at);
    expect((await adminWorkspacesCached(true)).at).not.toBe(first.at);
  });

  it("a workspace's partners carry their own revenue and earnings", async () => {
    const { adminWorkspace } = await admin();
    const { addPartner } = await import("./helpers");
    const { commission } = await import("@openpromoter/db");
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await db()
      .insert(commission)
      .values({
        id: `com_${Date.now()}`,
        programId: f.program.id,
        workspaceId: f.ws.id,
        partnerId: p.id,
        sourceKey: `sale:${Date.now()}`,
        kind: "sale",
        saleAmount: 10000,
        amount: 3000,
        currency: "usd",
        status: "approved",
      } as never);
    const { partners } = await adminWorkspace(f.ws.id);
    expect(partners.find((x) => x.id === p.id)).toMatchObject({ revenue: 10000, earned: 3000 });
  });
});
