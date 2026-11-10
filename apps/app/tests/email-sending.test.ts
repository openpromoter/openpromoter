import { emailLog, partner, program, prospect, reportSubscription } from "@openpromoter/db";
import { renderNotice } from "@openpromoter/emails";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as unsubscribeGet, POST as unsubscribePost } from "@/app/api/unsubscribe/route";
import { createId } from "@/lib/id";
import { emailSafeImage, pickLogo } from "@/server/ai/brand";
import { inviteUrl, markInvited } from "@/server/ai/recruiter";
import { SYSTEM } from "@/server/audit";
import { db } from "@/server/db";
import { envelope, programSender, senderName } from "@/server/email";
import { enqueue, runDueJobs } from "@/server/jobs";
import { applyToProgram, sendMessage } from "@/server/partners";
import { readToken, unsubscribeToken, unsubscribeUrl } from "@/server/unsubscribe";
import { registerJobs } from "@/server/worker";
import { addPartner, fixture } from "./helpers";

beforeAll(() => registerJobs());

const sent = async (to: string) => db().select().from(emailLog).where(eq(emailLog.to, to.toLowerCase()));
const drain = async () => {
  while ((await runDueJobs(50)) > 0);
};

describe("who partner emails come from", () => {
  it("shows the program as the sender and sends replies to the owner, or the program's reply-to", async () => {
    const f = await fixture({ name: "Acme Analytics" });
    const own = await programSender(f.program);
    expect(own).toMatchObject({ fromName: "Acme Analytics", replyTo: f.user.email, programId: f.program.id });
    await db().update(program).set({ replyTo: "partners@acme.test" }).where(eq(program.id, f.program.id));
    const [p2] = await db().select().from(program).where(eq(program.id, f.program.id));
    expect((await programSender(p2!)).replyTo).toBe("partners@acme.test");

    const e = envelope({ to: "x@y.test", subject: "s", html: "", ...own, unsubscribe: "https://u.test/x" });
    // the program's name, our address: SPF, DKIM and DMARC still pass for our domain
    expect(e.from).toMatch(/^"Acme Analytics" <[^<>\s]+@[^<>\s]+>$/);
    expect(e.replyTo).toBe(f.user.email);
    expect(e.headers).toEqual({
      "List-Unsubscribe": "<https://u.test/x>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    // account emails keep OpenPromoter as the sender and carry no unsubscribe
    expect(envelope({ to: "x@y.test", subject: "s", html: "" }).headers).toBeUndefined();
  });

  it("a program name can't break the From header", () => {
    expect(senderName('Evil"\r\nBcc: all@x.test <a>')).toBe("Evil Bcc: all@x.test a");
    expect(senderName("   ")).toBe("OpenPromoter");
    expect(senderName("x".repeat(90))).toHaveLength(60);
  });
});

describe("partner email choices and one-click unsubscribe", () => {
  it("signs tokens so they can't be forged or moved to another partner", () => {
    const t = unsubscribeToken("commissions", "prt_abc");
    expect(readToken(t)).toEqual({ kind: "commissions", id: "prt_abc" });
    expect(readToken(t.replace("prt_abc", "prt_xyz"))).toBeNull();
    expect(readToken(t.replace(/^c\./, "m."))).toBeNull();
    expect(readToken("garbage")).toBeNull();
    expect(unsubscribeUrl("messages", "prt_1")).toMatch(/\/api\/unsubscribe\?t=m\.prt_1\./);
  });

  it("GET only asks; POST (the button or the mail app's one-click) turns the email off", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const url = `http://app.test/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken("commissions", p.id))}`;
    const get = await unsubscribeGet(new Request(url));
    expect(await get.text()).toContain("Unsubscribe from these emails?");
    let [row] = await db().select().from(partner).where(eq(partner.id, p.id));
    expect(row?.emailCommissions).toBe(true);

    const post = await unsubscribePost(
      new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" }),
    );
    expect(await post.text()).toContain("You won't get commission emails by email anymore.");
    [row] = await db().select().from(partner).where(eq(partner.id, p.id));
    expect(row).toMatchObject({ emailCommissions: false, emailMessages: true });

    const bad = await unsubscribePost(
      new Request("http://app.test/api/unsubscribe?t=c.prt_x.0000", { method: "POST" }),
    );
    expect(await bad.text()).toContain("Link not valid");
  });

  it("a report unsubscribe removes that subscription", async () => {
    const f = await fixture();
    const id = createId("rpt");
    await db().insert(reportSubscription).values({
      id,
      programId: f.program.id,
      email: f.user.email,
      frequency: "weekly",
      lastSentAt: new Date(),
    });
    const url = `http://app.test/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken("report", id))}`;
    await unsubscribePost(new Request(url, { method: "POST" }));
    expect(await db().select().from(reportSubscription).where(eq(reportSubscription.id, id))).toHaveLength(0);
  });

  it("commission emails and program messages respect the partner's choice; payouts still go", async () => {
    const f = await fixture();
    const on = await addPartner(f.program.id, f.ws.id, { email: `on-${createId("com")}@p.test` });
    const off = await addPartner(f.program.id, f.ws.id, { email: `off-${createId("com")}@p.test` });
    await db()
      .update(partner)
      .set({ emailCommissions: false, emailMessages: false })
      .where(eq(partner.id, off.id));
    const { commission } = await import("@openpromoter/db");
    for (const pt of [on, off]) {
      const id = createId("com");
      await db().insert(commission).values({
        id,
        programId: f.program.id,
        workspaceId: f.ws.id,
        partnerId: pt.id,
        kind: "sale",
        sourceKey: id,
        amount: 3000,
        currency: "usd",
        fxRate: 1,
      });
      await enqueue("notify.commission", { commissionId: id });
    }
    await sendMessage(f.program, { partnerId: null, subject: "News", body: "Hello partners" });
    await drain();
    const onMail = await sent(on.email);
    expect(onMail.map((m) => m.subject).sort()).toEqual(["News", "You earned $30.00 from Acme"]);
    expect(onMail.every((m) => m.programId === f.program.id)).toBe(true);
    expect(await sent(off.email)).toHaveLength(0);
  });
});

describe("recruiter invites go out from the founder's own mailbox", () => {
  it("marking an invite records it without sending anything, and the join link lets them in", async () => {
    const f = await fixture({ visibility: "invite_only" });
    const pr = { id: createId("pro"), email: "maya@prospect.test" };
    await db()
      .insert(prospect)
      .values({ ...pr, programId: f.program.id, source: "customer", name: "Maya", reason: "fit" });
    expect(inviteUrl(f.program, pr)).toMatch(
      new RegExp(`/apply\\?invite=${pr.id}&email=maya%40prospect\\.test$`),
    );
    expect(await markInvited(f.program, [pr.id], SYSTEM)).toBe(1);
    const [row] = await db().select().from(prospect).where(eq(prospect.id, pr.id));
    expect(row).toMatchObject({ status: "sent", followUpAt: null });
    expect(await sent(pr.email)).toHaveLength(0);
    const { partner: joined } = await applyToProgram(
      f.program,
      { email: pr.email, name: "Maya", source: "recruiter" },
      true,
    );
    expect(joined.status).toBe("approved");
    const [after] = await db()
      .select()
      .from(prospect)
      .where(and(eq(prospect.id, pr.id), eq(prospect.programId, f.program.id)));
    expect(after?.status).toBe("joined");
  });
});

describe("logos in emails", () => {
  it("picks the large app icon, skips SVG, .ico and the social banner", () => {
    const html = `<link rel="icon" href="/favicon.svg"><link rel="icon" href="/favicon.ico">
      <link rel="icon" type="image/png" sizes="32x32" href="/f32.png">
      <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
      <meta property="og:image" content="/banner.png">`;
    expect(pickLogo(html, null)).toBe("/apple.png");
    expect(
      pickLogo('<link rel="icon" href="/a.svg"><link rel="icon" sizes="64x64" href="/b.png">', null),
    ).toBe("/b.png");
    expect(pickLogo('<link rel="icon" href="/a.svg">', "/logo.png")).toBe("/logo.png");
    expect(pickLogo('<link rel="icon" href="/a.svg">', null)).toBeNull();
    expect(emailSafeImage("https://x.test/logo.svg?v=2")).toBe(false);
    expect(emailSafeImage("https://x.test/logo.png")).toBe(true);
  });

  it("shows the OpenPromoter PNG on our emails and the name next to any logo", async () => {
    const ours = await renderNotice({
      brandName: "OpenPromoter",
      preview: "p",
      title: "t",
      paragraphs: ["x"],
    });
    expect(ours).toContain("https://openpromoter.com/email/openpromoter-logo.png");
    const theirs = await renderNotice({
      brandName: "DevDiggers",
      logoUrl: "https://devdiggers.test/logo.png",
      preview: "p",
      title: "t",
      paragraphs: ["x"],
      unsubscribeUrl: "https://app.test/api/unsubscribe?t=abc",
    });
    expect(theirs).toContain("https://devdiggers.test/logo.png");
    expect(theirs).toMatch(/>DevDiggers<\/td>/);
    expect(theirs).toContain('href="https://app.test/api/unsubscribe?t=abc"');
  });
});
