import { apiKey } from "@openpromoter/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { createId } from "@/lib/id";
import type { ApiScope } from "@/lib/scopes";
import { type Actor, audit } from "./audit";
import { db } from "./db";
import { env } from "./env";

/** Keys from the MCP sign-in start with this; their stored prefix keeps it. */
export const OAUTH_KEY_PREFIX = "op_mcp_";

/** Creates an API key and returns the raw key, shown once. Settings and the MCP OAuth flow both use it. */
export async function mintApiKey(input: {
  workspaceId: string;
  name: string;
  scopes: ApiScope[];
  userId: string;
  actor: Actor;
  /** Issued by the MCP sign-in: works only while its creator still has developer access to the workspace. */
  oauth?: boolean;
}) {
  const kind = input.oauth ? "mcp" : env.HOSTED_MODE === "true" ? "live" : "sk";
  const raw = `op_${kind}_${randomToken(24)}`;
  await db()
    .insert(apiKey)
    .values({
      id: createId("key"),
      workspaceId: input.workspaceId,
      name: input.name,
      prefix: raw.slice(0, 12),
      hash: sha256(raw),
      scopes: input.scopes,
      createdBy: input.userId,
    });
  await audit(
    input.workspaceId,
    input.actor,
    "api_key.create",
    { type: "api_key", id: raw.slice(0, 12) },
    { scopes: input.scopes },
  );
  return raw;
}
