import { DEMO } from "@/lib/demo-accounts";
import { subdomainOrigin } from "@/lib/subdomain";
import { demoOn } from "@/server/demo";

/**
 * app.openpromoter.com/demo: straight into the read-only demo dashboard (server/demo.ts). ?as=partner opens
 * the partner portal, on the demo program's free subdomain when those are on (it shows that feature too).
 */
export function GET(req: Request) {
  if (!demoOn()) return new Response("Not found", { status: 404 });
  const partner = new URL(req.url).searchParams.get("as") === "partner";
  const sign = `/api/auth/demo/sign-in?as=${partner ? "partner" : "founder"}`;
  const origin = partner ? subdomainOrigin(DEMO.slug) : null;
  return new Response(null, { status: 307, headers: { Location: origin ? `${origin}${sign}` : sign } });
}
