import { serverMetadata } from "@/server/oauth";

/** RFC 8414 metadata for the MCP OAuth flow (server/oauth.ts). */
export const GET = () => Response.json(serverMetadata());
