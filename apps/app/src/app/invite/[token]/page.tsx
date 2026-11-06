import { redirect } from "next/navigation";
import { acceptInviteAction } from "@/app/app/[programId]/settings-actions";
import { AuthCard } from "@/components/auth/auth-card";
import { requireUser, userPrograms } from "@/server/context";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const u = await requireUser(`/invite/${token}`);
  const r = await acceptInviteAction(token);
  if (r.ok) {
    const p = (await userPrograms(u.id)).find((x) => x.workspaceId === r.data);
    redirect(p ? `/app/${p.id}` : "/app");
  }
  return (
    <AuthCard title="Invitation problem">
      <p className="text-[13px] text-muted">{r.error}</p>
    </AuthCard>
  );
}
