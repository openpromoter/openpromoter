import { createHash } from "node:crypto";
import { member } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as resourceMeta } from "@/app/.well-known/oauth-protected-resource/route";
import { POST as register } from "@/app/api/oauth/register/route";
import { POST as token } from "@/app/api/oauth/token/route";
import { POST as mcp } from "@/app/mcp/route";
import { db } from "@/server/db";
import { issueCode, readClient, registerClient } from "@/server/oauth";
import { fixture } from "./helpers";

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const rpc = (t: string | null, method: string, params: unknown = {}) =>
  mcp(
    new Request(
      "http://localhost:3000/mcp",
      json(
        { jsonrpc: "2.0", id: 1, method, params },
        {
          accept: "application/json, text/event-stream",
          ...(t ? { authorization: `Bearer ${t}` } : {}),
        },
      ),
    ),
  );

async function connect(access: "read" | "write") {
  const f = await fixture();
  const client = registerClient({
    client_name: "Claude",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  });
  const verifier = "v".repeat(50);
  const code = await issueCode({
    clientId: client.clientId,
    redirectUri: client.redirectUris[0]!,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    workspaceId: f.ws.id,
    userId: f.user.id,
    access,
  });
  const form = (v: string) =>
    new Request("http://localhost:3000/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.clientId,
        redirect_uri: client.redirectUris[0]!,
        code_verifier: v,
      }),
    });
  return { f, form, verifier, client };
}

describe("remote MCP with OAuth", () => {
  it("points unauthenticated clients at the sign-in metadata", async () => {
    const r = await rpc(null, "tools/list");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/mcp");
    const meta = await resourceMeta().json();
    expect(meta.resource).toMatch(/\/mcp$/);
  });

  it("registers only https or localhost redirects, and client ids can't be forged", async () => {
    const ok = await register(
      new Request(
        "http://localhost:3000/api/oauth/register",
        json({ redirect_uris: ["http://localhost:6274/cb"] }),
      ),
    );
    expect(ok.status).toBe(201);
    const { client_id } = await ok.json();
    expect(readClient(client_id)?.redirectUris).toEqual(["http://localhost:6274/cb"]);
    expect(readClient(client_id.replace(/.$/, (c: string) => (c === "a" ? "b" : "a")))).toBeNull();
    const bad = await register(
      new Request(
        "http://localhost:3000/api/oauth/register",
        json({ redirect_uris: ["http://evil.test/cb"] }),
      ),
    );
    expect(bad.status).toBe(400);
  });

  it("a code is single use and needs the PKCE verifier", async () => {
    const { form, verifier } = await connect("read");
    expect((await token(form("w".repeat(50)))).status).toBe(400);
    // the wrong verifier burned the code: the right one can't use it now
    expect((await (await token(form(verifier))).json()).error).toBe("invalid_grant");
  });

  it("a read-only token lists read tools and runs them in this process", async () => {
    const { f, form, verifier } = await connect("read");
    const t = await (await token(form(verifier))).json();
    expect(t.token_type).toBe("Bearer");
    const list = await (await rpc(t.access_token, "tools/list")).json();
    const names = list.result.tools.map((x: { name: string }) => x.name);
    expect(names).toContain("list_programs");
    expect(names).not.toContain("invite_partner");
    expect(list.result.tools[0].annotations.readOnlyHint).toBe(true);
    const call = await (
      await rpc(t.access_token, "tools/call", { name: "list_programs", arguments: {} })
    ).json();
    expect(call.result.isError).toBeFalsy();
    expect(call.result.content[0].text).toContain(f.program.id);
  });

  it("a write token also gets the write tools", async () => {
    const { form, verifier } = await connect("write");
    const t = await (await token(form(verifier))).json();
    const list = await (await rpc(t.access_token, "tools/list")).json();
    const names = list.result.tools.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining(["invite_partner", "prepare_payouts"]));
  });

  it("a key from the sign-in starts with op_mcp_ and stops when its creator loses access", async () => {
    const { f, form, verifier } = await connect("read");
    const t = await (await token(form(verifier))).json();
    expect(t.access_token).toMatch(/^op_mcp_/);
    expect((await rpc(t.access_token, "tools/list")).status).toBe(200);
    const where = and(eq(member.workspaceId, f.ws.id), eq(member.userId, f.user.id));
    await db().update(member).set({ role: "viewer" }).where(where);
    expect((await rpc(t.access_token, "tools/list")).status).toBe(401);
    await db().update(member).set({ role: "admin" }).where(where);
    expect((await rpc(t.access_token, "tools/list")).status).toBe(200);
    await db().delete(member).where(where);
    expect((await rpc(t.access_token, "tools/list")).status).toBe(401);
  });

  it("a code_verifier must be 43 to 128 characters", async () => {
    const short = "s".repeat(42);
    const f = await fixture();
    const client = registerClient({ redirect_uris: ["http://localhost:6274/cb"] });
    const code = await issueCode({
      clientId: client.clientId,
      redirectUri: client.redirectUris[0]!,
      challenge: createHash("sha256").update(short).digest("base64url"),
      workspaceId: f.ws.id,
      userId: f.user.id,
      access: "read",
    });
    const r = await token(
      new Request("http://localhost:3000/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: client.clientId,
          redirect_uri: client.redirectUris[0]!,
          code_verifier: short,
        }),
      }),
    );
    expect((await r.json()).error).toBe("invalid_request");
  });

  it("a known app's name only goes with that app's own domain or this machine", () => {
    const reg = (client_name: string, uri: string) => () =>
      registerClient({ client_name, redirect_uris: [uri] });
    expect(reg("Claude", "https://evil.test/cb")).toThrow(/belongs to another app/);
    expect(reg("ChatGPT connector", "https://evil.test/cb")).toThrow(/belongs to another app/);
    expect(reg("OpenPromoter", "https://evil.test/cb")).toThrow(/belongs to another app/);
    expect(reg("Claude", "https://claude.ai/api/mcp/auth_callback")).not.toThrow();
    expect(reg("ChatGPT", "https://chatgpt.com/connector_platform_oauth_redirect")).not.toThrow();
    expect(reg("Claude Code", "http://localhost:33418/callback")).not.toThrow();
    expect(reg("My agent", "https://evil.test/cb")).not.toThrow();
  });

  it("a malformed request shows an error page instead of redirecting to the client", async () => {
    const client = registerClient({ client_name: "Mine", redirect_uris: ["https://evil.test/cb"] });
    // no response_type or PKCE, and nobody signed in: must not bounce to evil.test
    const { default: AuthorizePage } = await import("@/app/oauth/authorize/page");
    const page = await AuthorizePage({
      searchParams: Promise.resolve({ client_id: client.clientId, redirect_uri: "https://evil.test/cb" }),
    });
    expect(JSON.stringify(page)).toContain("This link doesn't work");
  });

  it("limits client registrations per address", async () => {
    const reg = () =>
      register(
        new Request(
          "http://localhost:3000/api/oauth/register",
          json({ redirect_uris: ["http://localhost:1/cb"] }, { "x-forwarded-for": "203.0.113.9" }),
        ),
      );
    for (let i = 0; i < 10; i++) expect((await reg()).status).toBe(201);
    expect((await reg()).status).toBe(429);
  });
});
