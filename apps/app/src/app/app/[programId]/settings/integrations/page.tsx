import { billingConnection } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { stripeOAuthUrl, webhookUrl } from "@/server/stripe-service";
import { IntegrationsView } from "./view";

export default async function IntegrationsPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p, role } = await programCtx(programId);
  const conns = await db()
    .select()
    .from(billingConnection)
    .where(eq(billingConnection.workspaceId, p.workspaceId));
  const c = (k: string) => conns.find((x) => x.provider === k);
  const status = (k: string) => {
    const x = c(k);
    return x
      ? {
          connected: true,
          webhook: !!x.webhookSecretEnc || x.mode === "oauth",
          livemode: x.livemode,
          importedAt: x.importedAt?.toISOString() ?? null,
          lastEventAt: x.lastEventAt?.toISOString() ?? null,
        }
      : null;
  };
  return (
    <IntegrationsView
      programId={programId}
      canWrite={role === "owner" || role === "admin"}
      canBilling={role === "owner"}
      local={/localhost|127\.0\.0\.1/.test(env.APP_URL)}
      oauthUrl={stripeOAuthUrl(`${p.workspaceId}:${programId}`)}
      urls={{
        stripe: webhookUrl("stripe", p.workspaceId),
        paddle: webhookUrl("paddle", p.workspaceId),
        lemonsqueezy: webhookUrl("lemonsqueezy", p.workspaceId),
        polar: webhookUrl("polar", p.workspaceId),
        chargebee: webhookUrl("chargebee", p.workspaceId),
      }}
      status={{
        stripe: status("stripe"),
        paddle: status("paddle"),
        lemonsqueezy: status("lemonsqueezy"),
        polar: status("polar"),
        chargebee: status("chargebee"),
        paypal: status("paypal"),
        wise: status("wise"),
      }}
    />
  );
}
