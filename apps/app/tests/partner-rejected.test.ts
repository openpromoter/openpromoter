import { job } from "@openpromoter/db";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setPartnerStatus } from "@/server/partners";
import { addPartner, fixture } from "./helpers";

const queued = async (id: string) =>
  (
    await db()
      .select({ id: job.id })
      .from(job)
      .where(and(eq(job.name, "notify.partner_rejected"), sql`${job.payload}->>'partnerId' = ${id}`))
  ).length;

describe("rejected applications", () => {
  it("emails an applicant once and leaves other partners alone", async () => {
    const f = await fixture();
    const applicant = await addPartner(f.program.id, f.ws.id, { status: "pending", approvedAt: null });
    const active = await addPartner(f.program.id, f.ws.id);
    const actor = { type: "user", id: f.user.id } as never;
    await setPartnerStatus(f.program.id, [applicant.id, active.id], "rejected", actor);
    expect(await queued(applicant.id)).toBe(1);
    expect(await queued(active.id)).toBe(0);
    // rejecting again is not a new decision
    await setPartnerStatus(f.program.id, [applicant.id], "rejected", actor);
    expect(await queued(applicant.id)).toBe(1);
  });
});
