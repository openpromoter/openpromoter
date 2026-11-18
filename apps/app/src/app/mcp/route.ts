import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { OpenPromoter } from "openpromoter";
import { registerTools } from "openpromoter-mcp/tools";
import { GET as v1 } from "@/app/api/v1/[...path]/route";
import { ApiError, authenticate } from "@/server/api";
import { appUrl } from "@/server/oauth";

/**
 * Remote MCP server (Streamable HTTP, stateless, JSON responses) for Claude, ChatGPT and other clients.
 * The bearer token is an API key, from the OAuth flow (server/oauth.ts) or pasted from Settings. Tools are
 * the same as the npm package's; their REST calls run in this process instead of over the network.
 */
const inProcess: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  const path = new URL(req.url).pathname
    .replace(/^\/api\/v1\//, "")
    .split("/")
    .map(decodeURIComponent);
  return v1(req, { params: Promise.resolve({ path }) });
};

export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req);
    const op = new OpenPromoter({
      apiKey: req.headers.get("authorization")!.slice(7).trim(),
      baseUrl: appUrl(),
      fetch: inProcess,
    });
    const server = new McpServer({ name: "openpromoter", version: "0.1.3" });
    // the API checks each call's scope too; this only hides tools the key can't use
    registerTools(server, op, ctx.scopes.includes("partners:write"));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(req);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return Response.json(
      { error: err.status === 401 ? "invalid_token" : err.code, error_description: err.message },
      {
        status: err.status,
        headers:
          err.status === 401
            ? {
                "WWW-Authenticate": `Bearer resource_metadata="${appUrl()}/.well-known/oauth-protected-resource/mcp"`,
              }
            : {},
      },
    );
  }
}

/** Stateless: no server-sent stream to open and no session to end. A browser visit gets a short note. */
const notAllowed = () =>
  new Response(
    "This is the OpenPromoter MCP server for AI apps. Add this URL as a connector in Claude, ChatGPT or another MCP app. Then sign in with your OpenPromoter account. Setup: https://openpromoter.com/docs/mcp/\n",
    { status: 405, headers: { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" } },
  );

export { notAllowed as GET, notAllowed as DELETE };
