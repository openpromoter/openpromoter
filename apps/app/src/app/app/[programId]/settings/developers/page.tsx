import { apiKey, webhookDelivery, webhookEndpoint } from "@openpromoter/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { EVENT_TYPES } from "@/server/events";
import { DevelopersView } from "./view";

export default async function DevelopersPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p, role } = await programCtx(programId);
  const [keys, endpoints] = await Promise.all([
    db()
      .select()
      .from(apiKey)
      .where(and(eq(apiKey.workspaceId, p.workspaceId), isNull(apiKey.revokedAt)))
      .orderBy(desc(apiKey.createdAt)),
    db().select().from(webhookEndpoint).where(eq(webhookEndpoint.workspaceId, p.workspaceId)),
  ]);
  const deliveries = endpoints.length
    ? await db()
        .select()
        .from(webhookDelivery)
        .where(
          inArray(
            webhookDelivery.endpointId,
            endpoints.map((e) => e.id),
          ),
        )
        .orderBy(desc(webhookDelivery.createdAt))
        .limit(30)
    : [];
  return (
    <DevelopersView
      programId={programId}
      appUrl={env.APP_URL}
      canWrite={role === "owner" || role === "admin"}
      events={[...EVENT_TYPES]}
      keys={keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      }))}
      endpoints={endpoints.map((e) => ({
        id: e.id,
        url: e.url,
        kind: e.kind,
        events: e.events,
        // only owners and admins may see signing secrets; others never get them in the page data
        secret: role === "owner" || role === "admin" ? e.secret : "",
      }))}
      deliveries={deliveries.map((d) => ({
        id: d.id,
        endpointId: d.endpointId,
        event: d.event,
        status: d.status,
        attempts: d.attempts,
        responseStatus: d.responseStatus,
        lastError: d.lastError,
        createdAt: d.createdAt.toISOString(),
      }))}
    />
  );
}
