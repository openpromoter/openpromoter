import { member, program, type Role } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { db } from "./db";

export type Permission =
  | "read"
  | "partners.write"
  | "program.write"
  | "money.write"
  | "team.write"
  | "billing.write"
  | "developer.write";

const MATRIX: Record<Role, Permission[]> = {
  owner: [
    "read",
    "partners.write",
    "program.write",
    "money.write",
    "team.write",
    "billing.write",
    "developer.write",
  ],
  admin: ["read", "partners.write", "program.write", "money.write", "team.write", "developer.write"],
  finance: ["read", "money.write"],
  viewer: ["read"],
};

export const can = (role: Role, perm: Permission) => MATRIX[role].includes(perm);

export class AccessError extends Error {
  constructor(
    message: string,
    public status: 401 | 403 | 404 = 403,
  ) {
    super(message);
  }
}

export async function membership(userId: string, workspaceId: string) {
  const [m] = await db()
    .select()
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.workspaceId, workspaceId)));
  return m ?? null;
}

/** Throws unless the user belongs to the workspace with a role that grants `perm`. */
export async function requireWorkspace(userId: string, workspaceId: string, perm: Permission = "read") {
  const m = await membership(userId, workspaceId);
  if (!m) throw new AccessError("Not found", 404);
  if (!can(m.role, perm)) throw new AccessError(`Your role (${m.role}) cannot do this`);
  return m;
}

/** Loads the program and checks the user's role in its workspace. Tenant isolation starts here. */
export async function requireProgram(userId: string, programId: string, perm: Permission = "read") {
  const [p] = await db().select().from(program).where(eq(program.id, programId));
  if (!p) throw new AccessError("Not found", 404);
  const m = await requireWorkspace(userId, p.workspaceId, perm);
  return { program: p, role: m.role };
}
