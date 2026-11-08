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
});
