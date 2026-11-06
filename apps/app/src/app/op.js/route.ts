import { snippet } from "@/lib/snippet";
import { env } from "@/server/env";
import { scriptResponse } from "@/server/static-script";

export const dynamic = "force-dynamic";

const body = snippet(env.APP_URL);

export function GET(req: Request) {
  return scriptResponse(req, body);
}
