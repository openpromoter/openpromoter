import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerTools, TOOLS } from "../src/tools";

// OpenAI review rejects tools whose hints are missing, null or do not match behavior.
describe("tool annotations", () => {
  it("every tool sets all four hints to a boolean", () => {
    const server = new McpServer({ name: "t", version: "0" });
    registerTools(server, {} as never, true);
    const reg = (server as any)._registeredTools as Record<string, { annotations: Record<string, unknown> }>;
    expect(Object.keys(reg)).toHaveLength(TOOLS.length);
    for (const [name, t] of Object.entries(reg))
      for (const k of ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"])
        expect(typeof t.annotations[k], `${name}.${k}`).toBe("boolean");
  });
});
