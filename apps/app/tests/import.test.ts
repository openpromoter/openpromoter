import { commission, partner, program, referral } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { overview, timeseries, topPartners } from "@/server/analytics";
import { SYSTEM } from "@/server/audit";
import { db } from "@/server/db";
import { importBalances, importPartners, importReferrals, parseAmount, parseCsv } from "@/server/importer";
import { ingest } from "@/server/ingest";
import { balances, mainBalance, payableBalances } from "@/server/ledger";
import { timeseriesForPartner } from "@/server/partner-stats";
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
    expect(r.notes).toEqual(["Row 2: b@x.io: code MAYA belongs to a@x.io"]);
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
    expect(ref).toMatchObject({ partnerId: p.id, status: "active", via: "import" });
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
    expect(first).toMatchObject({
      created: 1,
      skipped: 1,
      notes: ["Row 3: no partner nobody@x.io in this program. Import partners first."],
    });
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

  it("does not pay a one-time commission again for an imported customer", async () => {
    const f = await fixture({ commissionDuration: "once" });
    const p = await addPartner(f.program.id, f.ws.id);
    await importReferrals(
      f.program.id,
      `partner_email,customer_id,status\n${p.email},cus_once,active`,
      SYSTEM,
    );
    await ingest(f.ws.id, "stripe", evt([payment("cus_once")]));
    const rows = await db().select().from(commission).where(eq(commission.partnerId, p.id));
    expect(rows).toHaveLength(0);
  });

  it("leaves the converted date empty when the file has none", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await importReferrals(f.program.id, `partner_email,customer_id\n${p.email},cus_nodate`, SYSTEM);
    const [ref] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_nodate"));
    expect(ref).toMatchObject({ convertedAt: null, paidInvoices: 1 });
  });

  it("skips a customer another program in the workspace already has", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const [other] = await db()
      .insert(program)
      .values({ ...f.program, id: `prg_other_${Date.now()}`, slug: `other-${Date.now()}` })
      .returning();
    const q = await addPartner(other!.id, f.ws.id);
    await importReferrals(other!.id, `partner_email,customer_id\n${q.email},cus_shared`, SYSTEM);
    const r = await importReferrals(f.program.id, `partner_email,customer_id\n${p.email},cus_shared`, SYSTEM);
    expect(r.created).toBe(0);
    expect(r.notes).toEqual(["Row 2: customer cus_shared already belongs to another program"]);
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
    expect((await importBalances(f.program.id, csv, SYSTEM)).created).toBe(1);
    expect((await importBalances(f.program.id, csv, SYSTEM)).created).toBe(0);
    const bal = await balances(f.program.id, [p.id]);
    expect(mainBalance(bal, f.program.currency)).toMatchObject({ approved: 12000, paid: 90000 });
    const payable = await payableBalances(f.program.id);
    expect(payable.find((b) => b.partnerId === p.id)?.approved).toBe(12000);
  });

  it("reads an empty amount cell as zero", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const r = await importBalances(f.program.id, `email,unpaid,total_paid\n${p.email},120.00,`, SYSTEM);
    expect(r.created).toBe(1);
  });

  it("refuses amounts it cannot read for sure", () => {
    expect(parseAmount("(120.00)")).toBe(-120);
    expect(parseAmount("1.234")).toBeNull();
  });

  it("skips a row whose amount does not parse and lists a missing partner", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const r = await importBalances(f.program.id, `email,unpaid\n${p.email},n/a\nghost@x.io,10`, SYSTEM);
    expect(r).toMatchObject({
      created: 0,
      skipped: 2,
      notes: [
        "Row 2: an amount could not be read for sure (write it like 1234.50)",
        "Row 3: no partner ghost@x.io in this program. Import partners first.",
      ],
    });
  });

  it("keeps imported totals out of the period's commission figures", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await importBalances(f.program.id, `email,unpaid,total_paid\n${p.email},120,900`, SYSTEM);
    const allTime = { from: new Date(0), to: new Date(Date.now() + 86_400_000) };
    expect((await overview(f.program.id, allTime)).commissions).toBe(0);
    expect((await timeseries(f.program.id, allTime)).reduce((n, d) => n + d.commissions, 0)).toBe(0);
    expect((await topPartners(f.program.id, allTime)).find((x) => x.id === p.id)?.commissions ?? 0).toBe(0);
  });
});

describe("files shaped like each tool's export", () => {
  it("reads a file Excel saved with a byte order mark", async () => {
    const f = await fixture();
    const r = await importPartners(f.program.id, "\uFEFFEmail,Token\nbom@x.io,bom-1", SYSTEM);
    expect(r.created).toBe(1);
  });

  it("refuses a file over 5,000 rows before writing anything", async () => {
    const f = await fixture();
    const rows = Array.from({ length: 5001 }, (_, i) => `big${i}@x.io`).join("\n");
    await expect(importPartners(f.program.id, `email\n${rows}`, SYSTEM)).rejects.toThrow(/5,001 rows/);
    const n = await db().select().from(partner).where(eq(partner.programId, f.program.id));
    expect(n).toHaveLength(0);
  });

  it("keeps the first of two rows with the same email or code", async () => {
    const f = await fixture();
    const r = await importPartners(
      f.program.id,
      "email,ref_id\nd1@x.io,dup\nd1@x.io,other\nd2@x.io,DUP",
      SYSTEM,
    );
    expect(r.created).toBe(1);
    expect(r.notes).toEqual([
      "Row 3: d1@x.io is already a partner",
      "Row 4: d2@x.io: code DUP belongs to d1@x.io",
    ]);
  });

  it("brings blocked and declined partners over without approving them", async () => {
    const f = await fixture();
    await importPartners(
      f.program.id,
      "email,status\ns1@x.io,active\ns2@x.io,suspended\ns3@x.io,denied\ns4@x.io,invited\ns5@x.io,disabled",
      SYSTEM,
    );
    const rows = await db().select().from(partner).where(eq(partner.programId, f.program.id));
    const by = Object.fromEntries(rows.map((p) => [p.email, p]));
    expect(by["s1@x.io"]).toMatchObject({ status: "approved" });
    expect(by["s2@x.io"]).toMatchObject({ status: "banned", approvedAt: null });
    expect(by["s3@x.io"]).toMatchObject({ status: "rejected" });
    expect(by["s4@x.io"]).toMatchObject({ status: "pending" });
    expect(by["s5@x.io"]).toMatchObject({ status: "paused" });
  });

  it("imports a coupon that is free and lists one that is taken", async () => {
    const f = await fixture();
    const r = await importPartners(f.program.id, "email,coupon\nc1@x.io,SAVE10\nc2@x.io,save10", SYSTEM);
    expect(r.created).toBe(2);
    expect(r.notes).toEqual(["Row 3: coupon SAVE10 is already taken. The partner came in without it."]);
  });

  it("Rewardful: affiliates with tokens, then customers by affiliate email, then a renewal pays", async () => {
    const f = await fixture();
    await importPartners(
      f.program.id,
      "id,first_name,last_name,email,paypal_email,wise_email,state,links.token\naff_1,Maya,Chen,maya@rw.io,,maya@wise.io,active,maya-c",
      SYSTEM,
    );
    const [p] = await db().select().from(partner).where(eq(partner.email, "maya@rw.io"));
    expect(p).toMatchObject({
      code: "maya-c",
      externalId: "aff_1",
      wiseEmail: "maya@wise.io",
      payoutMethod: "wise",
    });
    const recent = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const r = await importReferrals(
      f.program.id,
      "affiliate.email,stripe_customer_id,customer.email,conversion_state,became_conversion_at\n" +
        `maya@rw.io,cus_rw1,lee@c.io,conversion,${recent}\nmaya@rw.io,cus_rw2,old@c.io,conversion,2024-01-01T00:00:00Z\n` +
        "maya@rw.io,,v@c.io,visitor,",
      SYSTEM,
    );
    expect(r.created).toBe(3);
    const [ref] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_rw1"));
    expect(ref).toMatchObject({ status: "active", paidInvoices: 1 });
    expect(ref!.convertedAt?.toISOString()).toBe(recent);
    await ingest(f.ws.id, "stripe", evt([payment("cus_rw1")]));
    expect(await db().select().from(commission).where(eq(commission.partnerId, p!.id))).toHaveLength(1);
    // converted almost three years ago: the 12-month window the plan pays for has ended
    await ingest(f.ws.id, "stripe", evt([payment("cus_rw2")]));
    expect(await db().select().from(commission).where(eq(commission.partnerId, p!.id))).toHaveLength(1);
  });

  it("Tolt: customers that name the partner only by Tolt's partner ID", async () => {
    const f = await fixture();
    await importPartners(
      f.program.id,
      "id,email,first_name,status,country_code\npart_9,t@tolt.io,Tia,active,de",
      SYSTEM,
    );
    const r = await importReferrals(
      f.program.id,
      "id,customer_id,email,partner_id,status\ncust_1,cus_t1,a@c.io,part_9,active\ncust_2,cus_t2,b@c.io,part_404,active",
      SYSTEM,
    );
    expect(r.created).toBe(1);
    expect(r.notes).toEqual(["Row 3: no partner with ID part_404 in this program. Import partners first."]);
    const [p] = await db().select().from(partner).where(eq(partner.email, "t@tolt.io"));
    expect(p).toMatchObject({ country: "DE" });
    const [ref] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_t1"));
    expect(ref?.partnerId).toBe(p!.id);
  });

  it("PartnerStack: the Stripe provider_key wins over PartnerStack's own customer_key", async () => {
    const f = await fixture();
    await importPartners(
      f.program.id,
      "partner_email,partner_key,partner_first,partner_last\nps@x.io,pk_1,Pat,S",
      SYSTEM,
    );
    await importReferrals(
      f.program.id,
      "customer_key,email,partner_key,name,created_at,provider_key\nck_1,cust@x.io,pk_1,Cust,2025-01-01,cus_ps1",
      SYSTEM,
    );
    const [ref] = await db().select().from(referral).where(eq(referral.email, "cust@x.io"));
    expect(ref?.externalCustomerId).toBe("cus_ps1");
  });

  it("FirstPromoter: a denied customer is left out, a trial still earns its first sale", async () => {
    const f = await fixture({ commissionDuration: "once" });
    await importPartners(f.program.id, "email,default_ref_id\nfp@x.io,fp1", SYSTEM);
    const r = await importReferrals(
      f.program.id,
      "email,uid,state,ref_id,customer_since\nx@c.io,cus_fp1,denied,fp1,\ny@c.io,cus_fp2,trial,fp1,",
      SYSTEM,
    );
    expect(r.created).toBe(1);
    expect(r.notes).toEqual(["Row 2: status denied means the old tool did not credit this customer"]);
    const [ref] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_fp2"));
    expect(ref).toMatchObject({ status: "trialing", paidInvoices: 0, convertedAt: null });
    await ingest(f.ws.id, "stripe", evt([payment("cus_fp2")]));
    expect(await db().select().from(commission).where(eq(commission.partnerId, ref!.partnerId))).toHaveLength(
      1,
    );
  });
});

describe("balances from a list of single commissions", () => {
  it("sums each partner's commissions by status, in cents when asked", async () => {
    const f = await fixture({ holdDays: 30 });
    await importPartners(f.program.id, "id,email\np_1,a@x.io\np_2,b@x.io", SYSTEM);
    const csv =
      "partner_id,amount,status,currency\n" +
      "p_1,4900,approved,usd\np_1,100,approved,usd\np_1,2500,pending,usd\np_1,9900,paid,usd\np_1,700,rejected,usd\n" +
      "p_2,1000,paid,eur\np_2,300,mystery,usd";
    const r = await importBalances(f.program.id, csv, SYSTEM, { cents: true });
    expect(r.created).toBe(1);
    expect(r.notes).toEqual([
      "Row 7: amount is in EUR but this program pays in USD",
      'Row 8: status "mystery" is not one we know (paid, due, approved, pending, voided…)',
    ]);
    const [a] = await db()
      .select()
      .from(partner)
      .where(and(eq(partner.programId, f.program.id), eq(partner.email, "a@x.io")));
    const rows = await db().select().from(commission).where(eq(commission.partnerId, a!.id));
    const sum = (st: string) => rows.filter((c) => c.status === st).reduce((n, c) => n + c.amount, 0);
    expect([sum("approved"), sum("paid"), sum("pending")]).toEqual([5000, 9900, 2500]);
    expect(rows).toHaveLength(4);
    const pending = rows.find((c) => c.status === "pending")!;
    const days = (pending.holdUntil!.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    // the same file again adds nothing
    expect((await importBalances(f.program.id, csv, SYSTEM, { cents: true })).created).toBe(0);
  });

  it("reads PartnerStack's COMMISSION_UNPAID and COMMISSION_PAID as cents without being told", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await importBalances(
      f.program.id,
      `email,COMMISSION_UNPAID,COMMISSION_PAID\n${p.email},12050,90000`,
      SYSTEM,
    );
    const bal = await balances(f.program.id, [p.id]);
    expect(mainBalance(bal, f.program.currency)).toMatchObject({ approved: 12050, paid: 90000 });
  });

  it("needs a status column for a list of single commissions", async () => {
    const f = await fixture();
    await expect(importBalances(f.program.id, "email,amount\na@x.io,10", SYSTEM)).rejects.toThrow(
      /status column/,
    );
  });
});

describe("partner-facing figures", () => {
  it("keeps imported totals out of the partner's earnings chart", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await importBalances(f.program.id, `email,unpaid,total_paid\n${p.email},75.50,1200`, SYSTEM);
    const days = await timeseriesForPartner(p.id, 30);
    expect(days.reduce((n, d) => n + d.earned, 0)).toBe(0);
  });
});

describe("review round two", () => {
  it("answers fast on a pathological 5 MB cell", async () => {
    const f = await fixture();
    const t = Date.now();
    await importPartners(f.program.id, `email\n"a@${".".repeat(1_000_000)}<"`, SYSTEM);
    parseAmount(`${"1".repeat(1_000_000)}-`);
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it("cuts any cell at 1,000 characters", () => {
    const [, row] = parseCsv(`email,code\n"${"x".repeat(5000)}",${"y".repeat(3000)}`);
    expect(row!.map((c) => c.length)).toEqual([1000, 1000]);
  });

  it("adds up a commission list split into two files and still ignores a re-run", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const one = `partner_email,amount,status\n${p.email},100,due`;
    const two = `partner_email,amount,status\n${p.email},50,due\n${p.email},200,paid`;
    await importBalances(f.program.id, one, SYSTEM);
    await importBalances(f.program.id, two, SYSTEM);
    await importBalances(f.program.id, two, SYSTEM);
    const bal = mainBalance(await balances(f.program.id, [p.id]), f.program.currency);
    expect(bal).toMatchObject({ approved: 15000, paid: 20000 });
  });

  it("keeps two identical commissions in one file as two", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await importBalances(
      f.program.id,
      `partner_email,amount,status\n${p.email},49,due\n${p.email},49,due`,
      SYSTEM,
    );
    const bal = mainBalance(await balances(f.program.id, [p.id]), f.program.currency);
    expect(bal.approved).toBe(9800);
  });

  it("treats a converted customer with no billing id as already paid", async () => {
    const f = await fixture({ commissionDuration: "once" });
    const p = await addPartner(f.program.id, f.ws.id);
    await importReferrals(
      f.program.id,
      `partner_email,customer_email,status\n${p.email},conv1@c.io,conversion\n${p.email},conv2@c.io,subscribed`,
      SYSTEM,
    );
    const rows = await db().select().from(referral).where(eq(referral.partnerId, p.id));
    expect(rows.map((r) => [r.status, r.paidInvoices])).toEqual([
      ["active", 1],
      ["active", 1],
    ]);
  });

  it("refuses amounts with letters instead of dropping them", () => {
    expect(parseAmount("1e9")).toBeNull();
    expect(parseAmount("0x10")).toBeNull();
    expect(parseAmount("12.5%")).toBeNull();
    expect(parseAmount("USD 49.00")).toBe(49);
    expect(parseAmount("49.00 EUR")).toBe(49);
  });

  it("skips amounts too large to store and keeps the rest of the file", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const q = await addPartner(f.program.id, f.ws.id);
    const r = await importBalances(
      f.program.id,
      `email,unpaid\n${p.email},99999999999\n${q.email},10`,
      SYSTEM,
    );
    expect(r.created).toBe(1);
    expect(r.notes).toEqual(["Row 2: an amount is too large to be right. Check the file."]);
  });

  it("keeps imported customers out of the period's leads and funnel", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await importReferrals(f.program.id, `partner_email,customer_id\n${p.email},cus_lead_x`, SYSTEM);
    const allTime = { from: new Date(0), to: new Date(Date.now() + 86_400_000) };
    expect((await overview(f.program.id, allTime)).leads).toBe(0);
    const [ref] = await db().select().from(referral).where(eq(referral.externalCustomerId, "cus_lead_x"));
    expect(ref?.via).toBe("import");
  });

  it("picks the partner's email column over a customer email column in a balance file", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const other = await addPartner(f.program.id, f.ws.id);
    await importBalances(
      f.program.id,
      `email,affiliate_email,amount,status\n${other.email},${p.email},30,due`,
      SYSTEM,
    );
    expect(mainBalance(await balances(f.program.id, [p.id]), f.program.currency).approved).toBe(3000);
  });
});
