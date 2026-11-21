import { createHash } from "node:crypto";
import { kvStore } from "@openpromoter/db";
import { and, eq, like, lt } from "drizzle-orm";
import { hmacHex, randomToken, safeEqual, sha256 } from "@/lib/crypto";
import type { ApiScope } from "@/lib/scopes";
import { mintApiKey } from "./api-keys";
import { db } from "./db";
import { env } from "./env";

/**
 * OAuth 2.1 for the remote MCP server (/mcp), so Claude, ChatGPT and other clients can connect with a
 * sign-in instead of a pasted key. The access token is an ordinary API key: the REST API checks it, its
 * scopes apply, and it is listed and revoked in Settings > API & webhooks like any other key.
 * Public clients only (PKCE S256, no client secret), registered dynamically (RFC 7591).
 */

export const appUrl = () => env.APP_URL.replace(/\/$/, "");

/** What the consent screen offers. "write" never includes moving money: payouts still need a person. */
export const ACCESS: Record<"read" | "write", ApiScope[]> = {
  read: ["read"],
  write: ["read", "partners:write", "payouts:request"],
};
export type Access = keyof typeof ACCESS;

export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function secret() {
  const s = process.env.BETTER_AUTH_SECRET ?? process.env.ENCRYPTION_KEY;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return `${s}:oauth-client`;
}

/** https anywhere, plain http only on this machine (Claude Code, MCP Inspector). */
export function allowedRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && LOOPBACK.includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Hosts of the AI apps people know by name. A client may call itself Claude, ChatGPT or OpenPromoter only
 * when every redirect goes to that company's own domain or to this machine, so a registration can't
 * borrow a trusted name to send someone's code to another site.
 */
const KNOWN_APPS: { pattern: RegExp; hosts: string[] }[] = [
  { pattern: /claude|anthropic/i, hosts: ["claude.ai", "claude.com"] },
  { pattern: /chat\s*gpt|openai/i, hosts: ["chatgpt.com", "chat.openai.com"] },
  { pattern: /open\s*promoter/i, hosts: [] },
];
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

/** The host a code is sent to, shown on the consent screen. */
export const redirectHost = (uri: string) => new URL(uri).host;

function nameAllowed(name: string, uris: string[]) {
  return KNOWN_APPS.every(
    (app) =>
      !app.pattern.test(name) ||
      uris.every((u) => {
        const h = new URL(u).hostname;
        return LOOPBACK.includes(h) || app.hosts.includes(h);
      }),
  );
}

/** The client's redirect URL with the result (code or error) and its state added. */
export function callbackUrl(redirectUri: string, params: Record<string, string | null | undefined>) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

export interface Client {
  name: string;
  redirectUris: string[];
}

// ponytail: stateless client ids (signed registration data), so the open registration endpoint never
// writes rows. Revoking one client means rotating BETTER_AUTH_SECRET; per-client rows if that ever matters.
export function registerClient(body: unknown): Client & { clientId: string } {
  const b = (body ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string" && u.length <= 500))
    throw new OAuthError("invalid_redirect_uri", "redirect_uris must list 1 to 10 URLs");
  if (!uris.every(allowedRedirect))
    throw new OAuthError("invalid_redirect_uri", "Redirect URLs must use https (or http on localhost)");
  const name =
    typeof b.client_name === "string" && b.client_name.trim()
      ? b.client_name.trim().slice(0, 40)
      : "MCP client";
  if (!nameAllowed(name, uris as string[]))
    throw new OAuthError(
      "invalid_client_metadata",
      "This client name belongs to another app. Choose a name of your own.",
    );
  const client: Client = { name, redirectUris: uris as string[] };
  const payload = Buffer.from(JSON.stringify(client)).toString("base64url");
  return { ...client, clientId: `${payload}.${hmacHex(secret(), payload).slice(0, 32)}` };
}

export function readClient(clientId: string | undefined | null): Client | null {
  const [payload, sig] = (clientId ?? "").split(".");
  if (!payload || !sig || !safeEqual(sig, hmacHex(secret(), payload).slice(0, 32))) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString()) as Client;
    return typeof c.name === "string" && Array.isArray(c.redirectUris) ? c : null;
  } catch {
    return null;
  }
}

const CODE_TTL = 10 * 60_000;

interface CodeGrant {
  clientId: string;
  redirectUri: string;
  challenge: string;
  workspaceId: string;
  userId: string;
  access: Access;
  exp: number;
}

/** Called after the person approves on the consent screen. Returns the one-time code. */
export async function issueCode(grant: Omit<CodeGrant, "exp">) {
  const code = randomToken(32);
  // codes nobody exchanged: drop them as new ones come in
  await db()
    .delete(kvStore)
    .where(and(like(kvStore.key, "oauth:code:%"), lt(kvStore.updatedAt, new Date(Date.now() - CODE_TTL))));
  await db()
    .insert(kvStore)
    .values({ key: `oauth:code:${sha256(code)}`, value: { ...grant, exp: Date.now() + CODE_TTL } });
  return code;
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Token endpoint, authorization_code grant. Single use: the code row is deleted as it is read. */
export async function exchangeCode(p: {
  code?: string | null;
  clientId?: string | null;
  redirectUri?: string | null;
  verifier?: string | null;
}) {
  if (!p.code || !p.verifier || !p.clientId || !p.redirectUri)
    throw new OAuthError("invalid_request", "code, code_verifier, client_id and redirect_uri are required");
  // RFC 7636: 43 to 128 unreserved characters
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(p.verifier))
    throw new OAuthError("invalid_request", "code_verifier must be 43 to 128 characters");
  const [row] = await db()
    .delete(kvStore)
    .where(eq(kvStore.key, `oauth:code:${sha256(p.code)}`))
    .returning();
  const g = row?.value as CodeGrant | undefined;
  if (!g || g.exp < Date.now()) throw new OAuthError("invalid_grant", "The code is invalid or expired");
  if (g.clientId !== p.clientId || g.redirectUri !== p.redirectUri)
    throw new OAuthError("invalid_grant", "The code was issued to another client");
  if (!safeEqual(s256(p.verifier), g.challenge))
    throw new OAuthError("invalid_grant", "code_verifier doesn't match the code_challenge");
  const client = readClient(g.clientId);
  const token = await mintApiKey({
    workspaceId: g.workspaceId,
    name: `${client?.name ?? "MCP client"} (MCP)`.slice(0, 60),
    scopes: ACCESS[g.access],
    userId: g.userId,
    actor: { type: "user", id: g.userId },
    oauth: true,
  });
  // ponytail: no expiry and no refresh token; the key lives until it's revoked in Settings > API & webhooks,
  // or until the person who connected it leaves the workspace or loses developer access (api.ts authenticate)
  return { access_token: token, token_type: "Bearer", scope: g.access };
}

export function serverMetadata() {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: Object.keys(ACCESS),
    service_documentation: "https://openpromoter.com/docs/mcp/",
  };
}

export function resourceMetadata() {
  const base = appUrl();
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: Object.keys(ACCESS),
    bearer_methods_supported: ["header"],
    resource_name: "OpenPromoter",
    resource_documentation: "https://openpromoter.com/docs/mcp/",
  };
}
