import { commission, partner, referral } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SYSTEM } from "@/server/audit";
import { db } from "@/server/db";
import { importBalances, importPartners, importReferrals, parseAmount } from "@/server/importer";
import { ingest } from "@/server/ingest";
import { balances, mainBalance, payableBalances } from "@/server/ledger";
import { addPartner, evt, fixture, payment } from "./helpers";

describe("partner import keeps codes", () => {
  it("keeps dashes, underscores and dots in codes", async () => {
    const f = await fixture();
    await importPartners(
      f.program.id,
      "email,referral_code\na@x.io,john-doe\nb@x.io,jane_s\nc@x.io,a.b",
      SYSTEM,
    );
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

describe("referral import", () => {
  it("imports a referral so the next renewal pays the old partner", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const r = await importReferrals(
      f.program.id,
      `partner_email,stripe_customer_id,customer_email,status\n${p.email},cus_imp1,c1@x.io,active`,
      SYSTEM,
    );
    expect(r.created).toBe(1);
    const [ref] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_imp1"));
    expect(ref).toMatchObject({ partnerId: p.id, status: "active", via: "manual" });
    await ingest(f.ws.id, "stripe", evt([payment("cus_imp1")]));
    const rows = await db().select().from(commission).where(eq(commission.partnerId, p.id));
    expect(rows).toHaveLength(1);
  });

  it("matches an email-only referral on the customer's first payment", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await importReferrals(f.program.id, `referral_code,customer_email\n${p.code},c2@x.io`, SYSTEM);
    await ingest(f.ws.id, "stripe", evt([payment("cus_imp2", { email: "c2@x.io" })]));
    const rows = await db().select().from(commission).where(eq(commission.partnerId, p.id));
    expect(rows).toHaveLength(1);
  });

  it("skips a customer that is already referred and lists rows with no partner", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const csv = `partner_email,customer_id\n${p.email},cus_imp3\nnobody@x.io,cus_imp4`;
    const first = await importReferrals(f.program.id, csv, SYSTEM);
    expect(first).toMatchObject({ created: 1, skipped: 1, missing: ["row 3: no partner nobody@x.io"] });
    const again = await importReferrals(f.program.id, csv, SYSTEM);
    expect(again.created).toBe(0);
  });

  it("does not duplicate an email-only referral on a second run", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const csv = `partner_email,customer_email\n${p.email},C6@x.io`;
    await importReferrals(f.program.id, csv, SYSTEM);
    expect((await importReferrals(f.program.id, csv, SYSTEM)).created).toBe(0);
  });

  it("sends no lead commission on import", async () => {
    const f = await fixture({ leadCommission: 500 });
    const p = await addPartner(f.program.id, f.ws.id);
    await importReferrals(f.program.id, `partner_email,customer_email\n${p.email},c5@x.io`, SYSTEM);
    const rows = await db().select().from(commission).where(eq(commission.partnerId, p.id));
    expect(rows).toHaveLength(0);
  });
});

describe("balance import", () => {
  it("parses money the way exports write it", () => {
    expect(parseAmount("$1,234.50")).toBe(1234.5);
    expect(parseAmount("1234.5")).toBe(1234.5);
    expect(parseAmount("€ 99")).toBe(99);
    expect(parseAmount("1.234,50 €")).toBe(1234.5);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("brings over unpaid and paid totals once", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const csv = `email,unpaid,total_paid\n${p.email},"$120.00",900`;
    expect((await importBalances(f.program.id, csv, SYSTEM)).created).toBe(2);
    expect((await importBalances(f.program.id, csv, SYSTEM)).created).toBe(0);
    const bal = await balances(f.program.id, [p.id]);
    expect(mainBalance(bal, f.program.currency)).toMatchObject({ approved: 12000, paid: 90000 });
    const payable = await payableBalances(f.program.id);
    expect(payable.find((b) => b.partnerId === p.id)?.approved).toBe(12000);
  });

  it("skips a row whose amount does not parse and lists a missing partner", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const r = await importBalances(f.program.id, `email,unpaid\n${p.email},n/a\nghost@x.io,10`, SYSTEM);
    expect(r).toMatchObject({ created: 0, skipped: 2, missing: ["row 3: no partner ghost@x.io"] });
  });
});
