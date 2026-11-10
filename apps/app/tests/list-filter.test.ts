import { commission } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { statusIs } from "@/lib/list";
import { SYSTEM } from "@/server/audit";
import { db } from "@/server/db";
import { createManualCommission } from "@/server/ledger";
import { addPartner, fixture } from "./helpers";

describe("list status filter", () => {
  it("matches the chosen status and nothing for an unknown one", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await createManualCommission(
      f.program.id,
      { partnerId: p.id, amount: 500, description: "Bonus" },
      SYSTEM,
    );
    const count = async (v: string) =>
      (
        await db()
          .select()
          .from(commission)
          .where(and(eq(commission.programId, f.program.id), statusIs(commission.status, v)))
      ).length;
    const [c] = await db().select().from(commission).where(eq(commission.programId, f.program.id));
    expect(await count(c!.status)).toBe(1);
    expect(await count("nonsense")).toBe(0);
  });
});
