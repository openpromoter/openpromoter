import {
  click,
  clickDaily,
  job,
  link,
  partner,
  partnerGroup,
  processedEvent,
  prospect,
  rateLimit as rateLimitTable,
  user,
} from "@openpromoter/db";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { hmacHex } from "@/lib/crypto";
import { createId } from "@/lib/id";
import { clickWindows, overview, timeseries } from "@/server/analytics";
import { verifyPaddle } from "@/server/billing/paddle";
import { verifyPolar } from "@/server/billing/polar";
import { assertFresh, WebhookSignatureError } from "@/server/billing/types";
import { db } from "@/server/db";
import { ingest } from "@/server/ingest";
import { defineJob, enqueue, runDueJobs } from "@/server/jobs";
import { applyToProgram } from "@/server/partners";
import { clientIp, memoryLimiter, postgresLimiter } from "@/server/ratelimit";
import { isPrivateAddress } from "@/server/safe-fetch";
import { signOAuthState, verifyOAuthState } from "@/server/stripe-service";
import { redirectClick } from "@/server/tracking";
import { contentSecurityPolicy, securityHeaders } from "../next.config";
import { addPartner, fixture } from "./helpers";

const H = 3_600_000;
const DAY = 24 * H;

describe("security headers", () => {
  const find = (rules: ReturnType<typeof securityHeaders>, source: string, key: string) =>
    rules.find((r) => r.source === source)?.headers.find((h) => h.key === key)?.value;

  it("CSP, HSTS and framing for pages; /embed stays frameable; SVG routes are sandboxed", () => {
    const rules = securityHeaders({ appUrl: "https://app.example.com", dev: false });
    expect(find(rules, "/:path*", "Strict-Transport-Security")).toBe("max-age=31536000");
    expect(find(rules, "/:path*", "X-Content-Type-Options")).toBe("nosniff");
    expect(find(rules, "/:path*", "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(find(rules, "/:path*", "Permissions-Policy")).toContain("camera=()");
    const pages = rules.find((r) => r.source.includes("(?!embed/"))!;
    const csp = pages.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(pages.headers.find((h) => h.key === "X-Frame-Options")?.value).toBe("SAMEORIGIN");
    // the pages rule must not match the embed route or the public scripts
    const re = new RegExp(`^${pages.source.replace("(.*)", "(.*)")}$`);
    expect(re.test("/app/prg_1")).toBe(true);
    expect(re.test("/embed/acme")).toBe(false);
    expect(re.test("/op.js")).toBe(false);
    expect(find(rules, "/embed/:path*", "Content-Security-Policy")).toContain("frame-ancestors *");
    expect(find(rules, "/api/banner/:path*", "Content-Security-Policy")).toContain("sandbox");
    expect(find(rules, "/api/qr", "Content-Security-Policy")).toContain("default-src 'none'");
  });

  it("no HSTS over http, eval only in dev", () => {
    const rules = securityHeaders({ appUrl: "http://localhost:3000", dev: true });
    expect(find(rules, "/:path*", "Strict-Transport-Security")).toBeUndefined();
    expect(contentSecurityPolicy({ dev: true, https: false, frameAncestors: "'self'" })).toContain(
      "'unsafe-eval'",
    );
  });
});

describe("rate limiter", () => {
  it("postgres: fixed window shared through the database, keys hashed", async () => {
    const key = `t:${Math.random()}`;
    const a = await postgresLimiter.hit(key, 2, 60_000);
    const b = await postgresLimiter.hit(key, 2, 60_000);
    const c = await postgresLimiter.hit(key, 2, 60_000);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, false]);
    expect(c.remaining).toBe(0);
    expect((await postgresLimiter.hit(`${key}:other`, 2, 60_000)).ok).toBe(true);
    const rows = await db().select().from(rateLimitTable);
    expect(rows.some((r) => r.key.includes(key))).toBe(false);
  });

  it("postgres: the window resets", async () => {
    const key = `t:${Math.random()}`;
    await postgresLimiter.hit(key, 1, 50);
    expect((await postgresLimiter.hit(key, 1, 50)).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect((await postgresLimiter.hit(key, 1, 50)).ok).toBe(true);
  });

  it("memory limiter has the same contract", async () => {
    const key = `m:${Math.random()}`;
    const r = [await memoryLimiter.hit(key, 1, 60_000), await memoryLimiter.hit(key, 1, 60_000)];
    expect(r.map((x) => x.ok)).toEqual([true, false]);
  });

  it("client IP: right-most X-Forwarded-For, spoofed CDN headers ignored unless trusted", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9", "cf-connecting-ip": "6.6.6.6" },
    });
    expect(clientIp(req)).toBe("203.0.113.9");
    process.env.TRUSTED_IP_HEADER = "cf-connecting-ip";
    try {
      expect(clientIp(req)).toBe("6.6.6.6");
    } finally {
      delete process.env.TRUSTED_IP_HEADER;
    }
  });
});

describe("webhook replay window", () => {
  const now = 1_800_000_000_000;
  it("accepts 5 minutes either way, rejects older, future and non-numeric timestamps", () => {
    expect(() => assertFresh(String(now / 1000 - 299), now)).not.toThrow();
    expect(() => assertFresh(String(now / 1000 + 299), now)).not.toThrow();
    for (const bad of [String(now / 1000 - 301), String(now / 1000 + 301), "abc", "", null, "1e9", "-1"])
      expect(() => assertFresh(bad, now)).toThrow(WebhookSignatureError);
  });

  it("Paddle: a correctly signed but non-numeric ts no longer skips the window", () => {
    const body = '{"event_type":"x","data":{}}';
    const header = `ts=abc;h1=${hmacHex("s", `abc:${body}`)}`;
    expect(() => verifyPaddle(body, header, "s", now)).toThrow(/tolerance/);
  });

  it("Polar: replayed message outside the window is rejected", async () => {
    const { createHmac } = await import("node:crypto");
    const body = '{"type":"x","data":{}}';
    const ts = String(now / 1000 - 3600);
    const sig = createHmac("sha256", Buffer.from("s", "utf8")).update(`m1.${ts}.${body}`).digest("base64");
    expect(() => verifyPolar(body, { id: "m1", timestamp: ts, signature: `v1,${sig}` }, "s", now)).toThrow(
      /tolerance/,
    );
    expect(() =>
      verifyPolar(body, { id: "m1", timestamp: ts, signature: `v1,${sig}` }, "s", Number(ts) * 1000),
    ).not.toThrow();
  });

  it("idempotency is per workspace: one tenant can't pre-claim another's event ids", async () => {
    const a = await fixture();
    const b = await fixture();
    const parsed = {
      eventId: "conversion:order_1001",
      eventType: "api.conversion",
      livemode: true,
      events: [],
    };
    expect((await ingest(a.ws.id, "api", parsed)).duplicate).toBe(false);
    expect((await ingest(b.ws.id, "api", parsed)).duplicate).toBe(false);
    expect((await ingest(a.ws.id, "api", parsed)).duplicate).toBe(true);
    const rows = await db().select().from(processedEvent).where(eq(processedEvent.eventId, parsed.eventId));
    expect(rows).toHaveLength(2);
  });
});

describe("click rollup", () => {
  it("click_daily matches raw clicks after inserts, updates and deletes", async () => {
    const f = await fixture();
    const p1 = await addPartner(f.program.id, f.ws.id);
    const p2 = await addPartner(f.program.id, f.ws.id);
    const base = Date.UTC(2026, 0, 10, 12);
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: createId("clk"),
      programId: f.program.id,
      partnerId: i % 3 ? p1.id : p2.id,
      visitorId: createId("vis"),
      isBot: i % 7 === 0,
      createdAt: new Date(base + (i - 20) * 3 * H),
    }));
    await db().insert(click).values(rows);
    await db().delete(click).where(eq(click.id, rows[0]!.id));
    await db().update(click).set({ isBot: true }).where(eq(click.id, rows[1]!.id));
    await db()
      .update(click)
      .set({ createdAt: new Date(base + 30 * DAY) })
      .where(eq(click.id, rows[2]!.id));
    const raw = await db()
      .select({
        partnerId: click.partnerId,
        day: sql<string>`to_char(${click.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        clicks: sql<number>`count(*) filter (where not ${click.isBot})::int`,
        bots: sql<number>`count(*) filter (where ${click.isBot})::int`,
      })
      .from(click)
      .where(eq(click.programId, f.program.id))
      .groupBy(sql`1`, sql`2`);
    const rolled = await db()
      .select()
      .from(clickDaily)
      .where(and(eq(clickDaily.programId, f.program.id), sql`${clickDaily.clicks} + ${clickDaily.bots} > 0`));
    const key = (x: { partnerId: string; day: string; clicks: number; bots: number }) =>
      `${x.partnerId}|${x.day}|${x.clicks}|${x.bots}`;
    expect(rolled.map(key).sort()).toEqual(raw.map(key).sort());

    // overview/timeseries read whole days from the rollup and partial edge days from raw rows: same totals
    const r = { from: new Date(base - 40 * H + 17 * 60_000), to: new Date(base + 50 * H) };
    expect(clickWindows(r).dayFrom).toBe("2026-01-09");
    const o = await overview(f.program.id, r);
    const [{ n }] = (await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(click)
      .where(
        and(
          eq(click.programId, f.program.id),
          eq(click.isBot, false),
          sql`${click.createdAt} >= ${r.from.toISOString()}::timestamptz and ${click.createdAt} < ${r.to.toISOString()}::timestamptz`,
        ),
      )) as [{ n: number }];
    expect(n).toBeGreaterThan(0);
    expect(o.clicks).toBe(n);
    expect(o.activePartners).toBe(2);
    const series = await timeseries(f.program.id, r);
    expect(series.reduce((a, d) => a + d.clicks, 0)).toBe(n);
    // a range shorter than a day is served from raw rows only
    const short = { from: new Date(base - 2 * H), to: new Date(base + 2 * H) };
    expect(clickWindows(short).dayFrom).toBe("1970-01-01");
    expect((await overview(f.program.id, short)).clicks).toBe(
      rows.slice(3).filter((x) => !x.isBot && x.createdAt >= short.from && x.createdAt < short.to).length,
    );
  });
});

describe("click redirect", () => {
  it("302s with the click id up front and writes the click after the response", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const tasks: (() => Promise<unknown>)[] = [];
    const res = await redirectClick(
      new Request(`http://app.test/r/${f.program.slug}/${p.code}?utm_source=x`, {
        headers: { "x-forwarded-for": "198.51.100.7" },
      }),
      f.program.slug,
      { code: p.code.toUpperCase() },
      (t) => tasks.push(t),
    );
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("https://acme.test");
    expect(loc.searchParams.get("utm_source")).toBe("x");
    const clickId = loc.searchParams.get("op_click")!;
    expect(await db().select().from(click).where(eq(click.id, clickId))).toHaveLength(0);
    for (const t of tasks) await t();
    expect(await db().select().from(click).where(eq(click.id, clickId))).toHaveLength(1);
  });

  it("never redirects to a non-http link destination; unknown programs 404", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    await db()
      .insert(link)
      .values({
        id: createId("lnk"),
        programId: f.program.id,
        partnerId: p.id,
        key: `bad${p.code}`,
        destination: "javascript://acme.test/%0aalert(1)",
      });
    const res = await redirectClick(
      new Request("http://app.test/r/x"),
      f.program.slug,
      { linkKey: `bad${p.code}` },
      () => {},
    );
    expect(res.headers.get("location")).toMatch(/^https:\/\/acme\.test\//);
    expect(
      (await redirectClick(new Request("http://app.test/r/x"), "nope", { code: "x" }, () => {})).status,
    ).toBe(404);
  });
});

describe("tenant isolation in the database", () => {
  it("a partner can't be put in another program's tier, from any write path", async () => {
    const a = await fixture();
    const b = await fixture();
    const p = await addPartner(a.program.id, a.ws.id);
    await expect(
      db().update(partner).set({ groupId: b.group.id }).where(eq(partner.id, p.id)),
    ).rejects.toThrow();
    await db().update(partner).set({ groupId: a.group.id }).where(eq(partner.id, p.id));
    await db().delete(partnerGroup).where(eq(partnerGroup.id, a.group.id));
    const [after] = await db().select().from(partner).where(eq(partner.id, p.id));
    expect(after?.groupId).toBeNull();
    expect(after?.programId).toBe(a.program.id);
  });
});

describe("partner sign-up abuse", () => {
  it("an unverified account can't claim a partner record someone else created", async () => {
    const f = await fixture();
    const invited = await addPartner(f.program.id, f.ws.id, { email: "bob@partner.test" });
    const u = { id: crypto.randomUUID(), name: "Mallory", email: "bob@partner.test" };
    await db().insert(user).values(u);
    await expect(
      applyToProgram(f.program, { email: u.email, name: "Mallory", userId: u.id }),
    ).rejects.toThrow(/confirmation link/);
    expect((await db().select().from(partner).where(eq(partner.id, invited.id)))[0]?.userId).toBeNull();
    await db().update(user).set({ emailVerified: true }).where(eq(user.id, u.id));
    await applyToProgram(f.program, { email: u.email, name: "Bob", userId: u.id });
    expect((await db().select().from(partner).where(eq(partner.id, invited.id)))[0]?.userId).toBe(u.id);
  });

  it("the public apply form's invite flag only auto-approves people the recruiter invited", async () => {
    const f = await fixture({
      autoApprove: {
        enabled: false,
        maxRiskScore: 40,
        requireWebsite: false,
        blockedCountries: [],
        allowedEmailDomains: [],
      },
    });
    const forged = await applyToProgram(
      f.program,
      { email: "eve@x.test", name: "Eve", source: "recruiter" },
      true,
    );
    expect(forged.partner.status).toBe("pending");
    await db()
      .insert(prospect)
      .values({
        id: createId("pro"),
        programId: f.program.id,
        source: "creator",
        name: "Ann",
        email: "ann@x.test",
        reason: "fit",
        status: "sent",
      });
    const real = await applyToProgram(
      f.program,
      { email: "ann@x.test", name: "Ann", source: "recruiter" },
      true,
    );
    expect(real.partner.status).toBe("approved");
  });
});

describe("job queue", () => {
  it("moves a job that keeps failing to the dead letter state and stops retrying it", async () => {
    defineJob("test.always_fails", async () => {
      throw new Error("boom");
    });
    await db().update(job).set({ doneAt: new Date() }).where(sql`${job.doneAt} is null`);
    await enqueue("test.always_fails", {}, { maxAttempts: 1 });
    expect(await runDueJobs(10)).toBe(1);
    const [row] = await db().select().from(job).where(eq(job.name, "test.always_fails"));
    expect(row?.failedAt).toBeInstanceOf(Date);
    expect(row?.lastError).toBe("boom");
    await db()
      .update(job)
      .set({ runAt: new Date(0) })
      .where(eq(job.id, row!.id));
    expect(await runDueJobs(10)).toBe(0);
  });
});

describe("SSRF and OAuth state", () => {
  it("blocks private, loopback, link-local, CGNAT and mapped addresses", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "100.64.1.1",
      "192.168.1.1",
      "172.16.0.1",
      "0.0.0.0",
      "::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "fd00::1",
      "fe80::1",
      "[::1]",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "2606:4700::1111", "8.8.8.8"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("Stripe OAuth state is signed and expires", () => {
    const s = signOAuthState("ws_1:prg_1", 1_800_000_000_000);
    expect(verifyOAuthState(s, 1_800_000_000_000 + 60_000)).toBe("ws_1:prg_1");
    expect(verifyOAuthState(s.replace("ws_1", "ws_2"), 1_800_000_000_000)).toBeNull();
    expect(verifyOAuthState("ws_1:prg_1", 1_800_000_000_000)).toBeNull();
    expect(verifyOAuthState(s, 1_800_000_000_000 + 2 * H)).toBeNull();
  });
});
