import { commission } from "@openpromoter/db";
import { describe, expect, it } from "vitest";
import { createId } from "@/lib/id";
import { ask } from "@/server/ai/assistant";
import { db } from "@/server/db";
import { createPayoutBatch } from "@/server/payouts";
import { addPartner, fixture } from "./helpers";

const approved = (programId: string, workspaceId: string, partnerId: string, amount: number) => {
  const id = createId("com");
  return db().insert(commission).values({
    id,
    programId,
    workspaceId,
    partnerId,
    kind: "sale",
    sourceKey: id,
    amount,
    currency: "usd",
    status: "approved",
  });
};

describe("Ask AI: how much do we owe", () => {
  it("counts money already in payouts waiting for approval, not only the next batch", async () => {
    const f = await fixture({ minPayout: 1000 });
    const a = await addPartner(f.program.id, f.ws.id);
    await approved(f.program.id, f.ws.id, a.id, 5000);
    await createPayoutBatch(f.program.id, { type: "system", id: null });
    const b = await addPartner(f.program.id, f.ws.id);
    await approved(f.program.id, f.ws.id, b.id, 3000);

    // no AI key in tests: the answer is the data summary itself
    const r = await ask(f.program.id, "how much do we owe partners", { base: "/app/x", currency: "usd" });
    expect(r.tool).toBe("payouts_owed");
    expect(r.text).toContain("You owe partners $80.00 in total.");
    expect(r.text).toContain("$50.00 is in 1 payout waiting for your approval.");
    expect(r.text).toContain("$30.00 more is approved for 1 partner");
    expect(r.rows).toHaveLength(2);
  });
});
