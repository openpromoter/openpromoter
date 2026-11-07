import { account } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { programCtx } from "@/server/context";
import { db } from "@/server/db";
import { AccountView } from "./view";

export default async function AccountPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const { user, role, program: p } = await programCtx(programId);
  const logins = await db()
    .select({ provider: account.providerId, password: account.password })
    .from(account)
    .where(eq(account.userId, user.id));
  return (
    <AccountView
      name={user.name}
      email={user.email}
      twoFactor={!!(user as { twoFactorEnabled?: boolean }).twoFactorEnabled}
      hasPassword={logins.some((l) => l.provider === "credential" && !!l.password)}
      social={logins.filter((l) => l.provider !== "credential").map((l) => l.provider)}
      workspaceExport={role === "owner" ? `/api/export/workspace?workspace=${p.workspaceId}` : null}
      programsHref={`/app/${programId}/settings/programs`}
    />
  );
}
