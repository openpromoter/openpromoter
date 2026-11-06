import { member, partner, program, workspace } from "@openpromoter/db";
import { and, asc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { AccessError, type Permission, requireProgram } from "./access";
import type { Actor } from "./audit";
import { getSession } from "./auth";
import { db } from "./db";

export const currentUser = cache(async () => (await getSession())?.user ?? null);

export async function requireUser(next = "/app") {
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(next)}`);
  return u;
}

export const actorOf = (u: { id: string }): Actor => ({ type: "user", id: u.id });

/** Program context for dashboard pages and actions. 404s on any tenant mismatch. */
export const programCtx = cache(async (programId: string, perm: Permission = "read") => {
  const u = await requireUser(`/app/${programId}`);
  try {
    const { program: p, role } = await requireProgram(u.id, programId, perm);
    const [ws] = await db().select().from(workspace).where(eq(workspace.id, p.workspaceId));
    return { user: u, program: p, role, workspace: ws!, actor: actorOf(u) };
  } catch (err) {
    if (err instanceof AccessError && err.status === 404) notFound();
    throw err;
  }
});

/** For server actions: throws (no redirect) so the caller can show a toast. */
export async function actionCtx(programId: string, perm: Permission) {
  const u = await currentUser();
  if (!u) throw new AccessError("Please sign in again", 401);
  const { program: p, role } = await requireProgram(u.id, programId, perm);
  return { user: u, program: p, role, actor: actorOf(u) };
}

export async function userPrograms(userId: string) {
  return db()
    .select({
      id: program.id,
      name: program.name,
      slug: program.slug,
      workspaceId: program.workspaceId,
      workspaceName: workspace.name,
      role: member.role,
      color: program.brand,
    })
    .from(member)
    .innerJoin(workspace, eq(workspace.id, member.workspaceId))
    .innerJoin(program, eq(program.workspaceId, workspace.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(program.createdAt));
}

/** Partner portal context: the signed-in user's partner record in this program. */
export const partnerCtx = cache(async (slug: string) => {
  const [p] = await db().select().from(program).where(eq(program.slug, slug));
  if (!p) notFound();
  const u = await requireUser(`/p/${slug}/portal`);
  const [pt] = await db()
    .select()
    .from(partner)
    .where(and(eq(partner.programId, p.id), eq(partner.userId, u.id)));
  if (!pt) redirect(`/p/${slug}/apply`);
  return { user: u, program: p, partner: pt, actor: { type: "partner" as const, id: pt.id } };
});

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string };

/** Wraps a server action body: maps thrown errors to a result the client toasts. */
export async function safe<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "digest" in err &&
      String((err as { digest: unknown }).digest).startsWith("NEXT_")
    )
      throw err;
    if (err instanceof Error && err.name === "ZodError")
      return { ok: false, error: "Some fields are invalid. Check the form and try again." };
    // database and driver errors carry SQL and parameters: log them, never show them
    const msg = err instanceof Error ? err.message : "";
    if (!msg || /^Failed query|syntax error|violates|relation "|column "|ECONN|timeout/i.test(msg)) {
      console.error("[action]", err);
      return { ok: false, error: "Something went wrong. Please try again." };
    }
    return { ok: false, error: msg };
  }
}
