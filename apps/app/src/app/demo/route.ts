import { demoOn } from "@/server/demo";

/** app.openpromoter.com/demo: straight into the read-only demo dashboard (server/demo.ts). */
export function GET(req: Request) {
  if (!demoOn()) return new Response("Not found", { status: 404 });
  const as = new URL(req.url).searchParams.get("as") === "partner" ? "partner" : "founder";
  return new Response(null, { status: 307, headers: { Location: `/api/auth/demo/sign-in?as=${as}` } });
}
