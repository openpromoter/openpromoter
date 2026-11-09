import { click, referral } from "@openpromoter/db";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { trafficReport } from "@/server/traffic";
import { addPartner, fixture } from "./helpers";

describe("traffic report", () => {
  it("groups human visits by source, country and device, and counts the ones that became customers", async () => {
    const f = await fixture();
    const p = await addPartner(f.program.id, f.ws.id);
    const now = Date.now();
    const base = {
      programId: f.program.id,
      partnerId: p.id,
      visitorId: "v",
      createdAt: new Date(now - 3600_000),
    };
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1) Mobile/15E148";
    await db()
      .insert(click)
      .values([
        {
          ...base,
          id: "clk_t1",
          referrer: "https://www.youtube.com/watch?v=1",
          country: "US",
          userAgent: iphone,
        },
        {
          ...base,
          id: "clk_t2",
          referrer: "https://youtube.com/",
          country: "US",
          userAgent: "Mozilla/5.0 (Macintosh)",
        },
        {
          ...base,
          id: "clk_t3",
          referrer: null,
          country: "IN",
          userAgent: "Mozilla/5.0 (Windows NT 10.0)",
          utm: { utm_source: "newsletter" },
        },
        {
          ...base,
          id: "clk_t4",
          referrer: "https://spam.example/",
          country: "US",
          userAgent: "bot",
          isBot: true,
        },
      ] as never);
    await db()
      .insert(referral)
      .values({
        id: "ref_t1",
        programId: f.program.id,
        partnerId: p.id,
        clickId: "clk_t1",
        visitorId: "v",
        convertedAt: new Date(),
      } as never);
    const t = await trafficReport({
      programId: f.program.id,
      partnerId: p.id,
      from: new Date(now - 86_400_000),
      to: new Date(now),
    });
    expect(t.clicks).toBe(3);
    expect(t.sources).toEqual(
      expect.arrayContaining([
        { key: "youtube.com", clicks: 2, customers: 1 },
        { key: "newsletter", clicks: 1, customers: 0 },
      ]),
    );
    expect(t.countries[0]).toMatchObject({ key: "US", clicks: 2 });
    expect(t.devices.find((d) => d.key === "Mobile")?.clicks).toBe(1);
    expect(t.devices.find((d) => d.key === "Desktop")?.clicks).toBe(2);
    expect(t.recent).toHaveLength(3);
    expect(t.recent.some((r) => r.customer)).toBe(true);
    expect(t.days.reduce((a, d) => a + d.clicks, 0)).toBe(3);
  });
});
