import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/tools";

describe("mcp tools", () => {
  it("no tool moves money; payouts only prepare", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).not.toContain("approve_payouts");
    expect(names).not.toContain("send_payout");
    expect(TOOLS.find((t) => t.name === "prepare_payouts")?.description).toMatch(/NEVER sends money/);
  });
  it("every write tool is flagged as write", () => {
    for (const t of TOOLS) if (/invite|set_|draft|apply|prepare/.test(t.name)) expect(t.write).toBe(true);
  });
});
