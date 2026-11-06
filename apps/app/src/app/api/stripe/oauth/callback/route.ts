import { redirect } from "next/navigation";
import { AccessError, requireWorkspace } from "@/server/access";
import { currentUser } from "@/server/context";
import { completeStripeOAuth, importStripe, verifyOAuthState } from "@/server/stripe-service";

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) redirect("/login");
  const url = new URL(req.url);
  // signed + time-limited by stripeOAuthUrl: a forged callback can't attach someone else's Stripe account
  const state = verifyOAuthState(url.searchParams.get("state") ?? "");
  const [workspaceId, programId, from] = (state ?? "").split(":");
  const code = url.searchParams.get("code");
  if (!workspaceId || !programId || !code || !/^prg_[\w-]{1,40}$/.test(programId)) redirect("/app");
  try {
    await requireWorkspace(u.id, workspaceId, "developer.write");
  } catch (e) {
    if (e instanceof AccessError) return new Response(e.message, { status: e.status });
    throw e;
  }
  const { webhookError } = await completeStripeOAuth(workspaceId, code, { type: "user", id: u.id });
  // same as connecting with a key: bring in products, customers and subscriptions; a failed import can be re-run in Settings
  await importStripe(workspaceId).catch((e) => console.error("stripe import after oauth", e));
  if (from === "onboarding") redirect(`/onboarding?program=${programId}&step=2`);
  // the integrations page shows the Stripe card without a webhook and asks for the signing secret
  redirect(`/app/${programId}/settings/integrations${webhookError ? "?stripe=webhook_failed" : ""}`);
}
