import { auditLog } from "@openpromoter/db";
import { createId } from "@/lib/id";
import { type AppDb, db, type Tx } from "./db";

export interface Actor {
  type: "user" | "api_key" | "system" | "ai" | "partner";
  id: string | null;
}

export const SYSTEM: Actor = { type: "system", id: null };

export async function audit(
  workspaceId: string,
  actor: Actor,
  action: string,
  target?: { type: string; id: string },
  data?: Record<string, unknown>,
  tx: AppDb | Tx = db(),
) {
  await tx.insert(auditLog).values({
    id: createId("aud"),
    workspaceId,
    actorType: actor.type,
    actorId: actor.id,
    action,
    targetType: target?.type,
    targetId: target?.id,
    data,
  });
}
