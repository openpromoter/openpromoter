import { partner, user } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createCode } from "@/lib/id";
import { db } from "@/server/db";
import { joinFromMarketplace, listMarketplace, marketplaceCategories } from "@/server/marketplace";
import { fixture } from "./helpers";

async function signedIn() {
  const u = { id: crypto.randomUUID(), name: "Mia Marketer", email: `mia-${createCode(6)}@x.test` };
  await db()
    .insert(user)
    .values({ ...u, emailVerified: true });
  return u;
}

describe("partner marketplace", () => {
  it("lists only opted-in public programs and filters by category and commission type", async () => {
    const tag = `Mk${createCode(4)}`;
    const ai = await fixture({ name: `${tag} AI`, listedInNetwork: true, category: "AI" });
    const fixed = await fixture({
      name: `${tag} Fixed`,
      listedInNetwork: true,
      category: "Finance",
      commissionType: "fixed",
      commissionValue: 5000,
    });
    const hidden = await fixture({ name: `${tag} Hidden`, listedInNetwork: false, category: "AI" });
    const priv = await fixture({ name: `${tag} Private`, listedInNetwork: true, visibility: "private" });
    const ids = (rows: Awaited<ReturnType<typeof listMarketplace>>) => rows.map((r) => r.program.id);

    const all = ids(await listMarketplace());
    expect(all).toEqual(expect.arrayContaining([ai.program.id, fixed.program.id]));
    expect(all).not.toContain(hidden.program.id);
    expect(all).not.toContain(priv.program.id);

    const aiOnly = ids(await listMarketplace({ category: "AI" }));
    expect(aiOnly).toContain(ai.program.id);
    expect(aiOnly).not.toContain(fixed.program.id);

    const fixedOnly = ids(await listMarketplace({ type: "fixed" }));
    expect(fixedOnly).toContain(fixed.program.id);
    expect(fixedOnly).not.toContain(ai.program.id);

    // an unknown category is ignored instead of matching nothing
    expect(ids(await listMarketplace({ category: "'; drop table program; --" }))).toEqual(all);
    expect(await marketplaceCategories()).toEqual(expect.arrayContaining(["AI", "Finance"]));
  });

  it("applies with one click from the signed-in account and shows the status after", async () => {
    const f = await fixture({ listedInNetwork: true, category: "Sales" });
    const u = await signedIn();
    const r = await joinFromMarketplace(u, f.program.slug, "9.9.9.9");
    expect(r.autoApproved).toBe(true);
    expect(r.partner).toMatchObject({ userId: u.id, email: u.email, programId: f.program.id });

    // a second click does not create a second partner
    await joinFromMarketplace(u, f.program.slug, "9.9.9.9");
    const rows = await db().select().from(partner).where(eq(partner.userId, u.id));
    expect(rows).toHaveLength(1);

    const listed = await listMarketplace({ category: "Sales" }, u.id);
    expect(listed.find((x) => x.program.id === f.program.id)?.status).toBe("approved");
  });

  it("refuses programs that are not listed or need application answers", async () => {
    const u = await signedIn();
    const off = await fixture({ listedInNetwork: false });
    await expect(joinFromMarketplace(u, off.program.slug, null)).rejects.toThrow(/not in the marketplace/);
    const inv = await fixture({ listedInNetwork: true, visibility: "invite_only" });
    await expect(joinFromMarketplace(u, inv.program.slug, null)).rejects.toThrow(/not in the marketplace/);
    const asks = await fixture({
      listedInNetwork: true,
      applicationQuestions: [{ id: "q1", label: "Audience size", type: "text", required: true }],
    });
    await expect(joinFromMarketplace(u, asks.program.slug, null)).rejects.toThrow(/Apply from its page/);
  });
});
