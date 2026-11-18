import { OAuthError, registerClient } from "@/server/oauth";

/** RFC 7591 dynamic client registration for MCP clients. Stores nothing (see registerClient). */
export async function POST(req: Request) {
  try {
    const c = registerClient(await req.json().catch(() => null));
    return Response.json(
      {
        client_id: c.clientId,
        client_name: c.name,
        redirect_uris: c.redirectUris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof OAuthError)
      return Response.json({ error: err.code, error_description: err.message }, { status: 400 });
    throw err;
  }
}
