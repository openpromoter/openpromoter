import { describe, expect, it } from "vitest";
import { hintsFromStripe, parseLanding, pickClick } from "@/server/attribution";

const c = (id: string, day: number) => ({
  id,
  partnerId: `p${id}`,
  programId: "prg",
  createdAt: new Date(Date.UTC(2026, 0, day)),
});

describe("attribution", () => {
  const now = new Date(Date.UTC(2026, 0, 31));
  it("first click vs last click", () => {
    const clicks = [c("b", 10), c("a", 5), c("c", 20)];
    expect(pickClick(clicks, "first_click", now, 60)?.id).toBe("a");
    expect(pickClick(clicks, "last_click", now, 60)?.id).toBe("c");
  });
  it("ignores clicks outside the cookie window", () => {
    expect(pickClick([c("a", 1)], "last_click", now, 10)).toBeNull();
    expect(pickClick([c("a", 1), c("b", 25)], "first_click", now, 10)?.id).toBe("b");
  });
  it("reads hints from Stripe objects", () => {
    expect(hintsFromStripe({ clientReferenceId: "clk_123" }).clickId).toBe("clk_123");
    expect(hintsFromStripe({ metadata: { op_ref: "pat" } }).partnerCode).toBe("pat");
    expect(hintsFromStripe({ metadata: { op_click: "clk_9", op_visitor: "vis_1" } })).toMatchObject({
      clickId: "clk_9",
      visitorId: "vis_1",
    });
    expect(hintsFromStripe({ clientReferenceId: "vis_77" }).visitorId).toBe("vis_77");
  });
  it("captures UTM, sub-id and code from landing URLs", () => {
    const l = parseLanding("https://acme.test/pricing?via=pat&sub=yt&utm_source=youtube&utm_campaign=launch");
    expect(l).toEqual({ code: "pat", subId: "yt", utm: { utm_source: "youtube", utm_campaign: "launch" } });
    expect(parseLanding("https://acme.test/?ref=sam", "ref").code).toBe("sam");
    expect(parseLanding("not a url").code).toBeNull();
  });
});

import { snippet } from "@/lib/snippet";

describe("op.js", () => {
  it("is valid JavaScript", () => {
    expect(() => new Function(snippet("https://app.example.com"))).not.toThrow();
    expect(snippet("https://app.example.com")).toContain('"https://app.example.com"');
  });
});
