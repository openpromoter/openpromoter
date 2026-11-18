import { exchangeCode, OAuthError } from "@/server/oauth";
import { clientIp, limit } from "@/server/ratelimit";

/** Token endpoint for the MCP OAuth flow: form-encoded per the spec, JSON accepted too. */
export async function POST(req: Request) {
  if (!(await limit(`oauth-token:${clientIp(req) ?? "unknown"}`, 30, 60_000)).ok)
    return Response.json({ error: "slow_down", error_description: "Too many requests" }, { status: 429 });
  const f = (req.headers.get("content-type") ?? "").includes("application/json")
    ? new URLSearchParams((await req.json().catch(() => ({}))) as Record<string, string>)
    : new URLSearchParams(await req.text());
  try {
    if (f.get("grant_type") !== "authorization_code")
      throw new OAuthError("unsupported_grant_type", "Only authorization_code is supported");
    const t = await exchangeCode({
      code: f.get("code"),
      clientId: f.get("client_id"),
      redirectUri: f.get("redirect_uri"),
      verifier: f.get("code_verifier"),
    });
    return Response.json(t, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof OAuthError)
      return Response.json(
        { error: err.code, error_description: err.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    throw err;
  }
}
