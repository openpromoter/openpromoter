import { programCtx } from "@/server/context";
import { AccountView } from "./view";

export default async function AccountPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { user, role, program: p } = await programCtx(programId);
  return (
    <AccountView
      name={user.name}
      email={user.email}
      twoFactor={!!(user as { twoFactorEnabled?: boolean }).twoFactorEnabled}
      workspaceExport={role === "owner" ? `/api/export/workspace?workspace=${p.workspaceId}` : null}
    />
  );
}
