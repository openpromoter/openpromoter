import { invitation, member, user } from "@openpromoter/db";
import { and, eq, isNull } from "drizzle-orm";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { TeamView } from "./view";

export default async function TeamPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { program: p, role, user: me } = await programCtx(programId);
  const [members, invites] = await Promise.all([
    db()
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: member.role,
        twoFactor: user.twoFactorEnabled,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.workspaceId, p.workspaceId)),
    db()
      .select()
      .from(invitation)
      .where(and(eq(invitation.workspaceId, p.workspaceId), isNull(invitation.acceptedAt))),
  ]);
  return (
    <TeamView
      programId={programId}
      me={me.id}
      canWrite={role === "owner" || role === "admin"}
      members={members.map((m) => ({ ...m, twoFactor: !!m.twoFactor }))}
      invites={invites
        .filter((i) => i.expiresAt > new Date())
        .map((i) => ({ id: i.id, email: i.email, role: i.role }))}
    />
  );
}
