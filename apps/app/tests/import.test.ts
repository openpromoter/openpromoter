import { partner } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SYSTEM } from "@/server/audit";
import { db } from "@/server/db";
import { importPartners } from "@/server/importer";
import { fixture } from "./helpers";

describe("partner import keeps codes", () => {
  it("keeps dashes, underscores and dots in codes", async () => {
    const f = await fixture();
    await importPartners(f.program.id, "email,referral_code\na@x.io,john-doe\nb@x.io,jane_s\nc@x.io,a.b", SYSTEM);
    const codes = (await db().select().from(partner).where(eq(partner.programId, f.program.id)))
      .map((p) => p.code)
      .sort();
    expect(codes).toEqual(["a.b", "jane_s", "john-doe"]);
  });

  it("skips a code another partner owns instead of renaming it", async () => {
    const f = await fixture();
    await importPartners(f.program.id, "email,referral_code\na@x.io,maya", SYSTEM);
    const r = await importPartners(f.program.id, "email,referral_code\nb@x.io,MAYA", SYSTEM);
    expect(r.created).toBe(0);
    expect(r.conflicts).toEqual(["b@x.io: code MAYA belongs to another partner"]);
  });
});
