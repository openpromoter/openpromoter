import { resourceMetadata } from "@/server/oauth";

/** RFC 9728: tells MCP clients where to sign in for /mcp. */
export const GET = () => Response.json(resourceMetadata());
