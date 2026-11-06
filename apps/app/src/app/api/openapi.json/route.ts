import { openApi } from "@/server/api";
import { env } from "@/server/env";

export function GET() {
  return Response.json(openApi(env.APP_URL), { headers: { "Access-Control-Allow-Origin": "*" } });
}
