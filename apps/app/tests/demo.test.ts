import { afterEach, describe, expect, it } from "vitest";
import { DEMO } from "@/lib/demo-accounts";
import { isDemoUser } from "@/server/demo";
import { applyToProgram } from "@/server/partners";
import { fixture } from "./helpers";

afterEach(() => {
  delete process.env.PUBLIC_DEMO;
});

describe("public demo", () => {
  it("knows its two accounts only while the demo is on", () => {
    expect(isDemoUser({ email: DEMO.email })).toBe(false);
    process.env.PUBLIC_DEMO = "true";
    expect(isDemoUser({ email: DEMO.email })).toBe(true);
    expect(isDemoUser({ email: DEMO.partnerEmail })).toBe(true);
    expect(isDemoUser({ email: "founder@real.test" })).toBe(false);
    expect(isDemoUser(null)).toBe(false);
  });

  it("nobody can join the demo program", async () => {
    process.env.PUBLIC_DEMO = "true";
    const f = await fixture();
    const demo = { ...f.program, slug: DEMO.slug };
    await expect(applyToProgram(demo, { email: "visitor@example.test", name: "V" })).rejects.toThrow("demo");
  });
});
