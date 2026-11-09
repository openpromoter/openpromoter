import { campaign, click, commission } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { settleEndedCampaigns } from "@/server/campaigns";
import { db } from "@/server/db";
import { addPartner, fixture } from "./helpers";

describe("contests", () => {
  it("ending a contest early pays its prizes once", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const start = new Date(Date.now() - 3 * 86_400_000);
    await db()
      .insert(click)
      .values(
        [1, 2, 3].map((i) => ({
          id: `clk_c${i}_${Date.now()}`,
          programId: f.program.id,
          partnerId: p.id,
          visitorId: `v${i}`,
          createdAt: new Date(),
        })) as never,
      );
    const id = `cmp_${Date.now()}`;
    await db()
      .insert(campaign)
      .values({
        id,
        programId: f.program.id,
        name: "Clicks contest",
        status: "active",
        startsAt: start,
        endsAt: new Date(Date.now() + 7 * 86_400_000),
        rule: { kind: "contest", metric: "clicks", prizes: [5000] },
      } as never);
    // what End now does: the end date becomes now, then that one campaign settles
    await db().update(campaign).set({ endsAt: new Date() }).where(eq(campaign.id, id));
    await settleEndedCampaigns(new Date(Date.now() + 1), id);
    await settleEndedCampaigns(new Date(Date.now() + 1), id);
    const prizes = await db()
      .select()
      .from(commission)
      .where(and(eq(commission.partnerId, p.id), eq(commission.campaignId, id)));
    expect(prizes).toHaveLength(1);
    expect(prizes[0]!.amount).toBe(5000);
    const [c] = await db().select().from(campaign).where(eq(campaign.id, id));
    expect(c!.status).toBe("ended");
  });
});
