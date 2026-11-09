import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OpenPromoter, OpenPromoterError } from "openpromoter";
import { TOOLS } from "./tools";

if (process.argv.includes("--version")) {
  console.log("0.1.2");
  process.exit(0);
}
if (process.argv.includes("--help")) {
  console.log(`openpromoter-mcp: MCP server for OpenPromoter over stdio.

Run it from your MCP client with: npx -y openpromoter-mcp
Environment:
  OPENPROMOTER_API_KEY    required, from Settings > API & webhooks
  OPENPROMOTER_URL        your OpenPromoter URL (default https://app.openpromoter.com)
  OPENPROMOTER_MCP_WRITE  true registers the write tools (off by default)
Docs: https://openpromoter.com/docs/mcp/`);
  process.exit(0);
}
const apiKey = process.env.OPENPROMOTER_API_KEY;
if (!apiKey) {
  console.error(
    "Set OPENPROMOTER_API_KEY (Settings > API & webhooks in OpenPromoter). Run with --help for details.",
  );
  process.exit(1);
}
const op = new OpenPromoter({
  apiKey,
  baseUrl: process.env.OPENPROMOTER_URL ?? "https://app.openpromoter.com",
});
const allowWrite = process.env.OPENPROMOTER_MCP_WRITE === "true";

const server = new McpServer({ name: "openpromoter", version: "0.1.2" });

for (const t of TOOLS) {
  if (t.write && !allowWrite) continue;
  server.registerTool(
    t.name,
    {
      description: t.description,
      inputSchema: t.input,
      annotations: { readOnlyHint: !t.write, destructiveHint: t.write, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        const out = await t.run(op, args);
        return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
      } catch (err) {
        const msg = err instanceof OpenPromoterError ? `${err.code}: ${err.message}` : (err as Error).message;
        return { isError: true, content: [{ type: "text" as const, text: msg }] };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
