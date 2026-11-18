import { Button } from "@openpromoter/ui";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { can } from "@/server/access";
import { requireUser, userPrograms } from "@/server/context";
import { callbackUrl, readClient } from "@/server/oauth";
import { authorizeAction } from "./actions";

export const metadata: Metadata = { title: "Connect an AI app", robots: { index: false, follow: false } };

const ACCESS_OPTIONS = [
  {
    value: "read",
    label: "Read only",
    detail: "See programs, partners, commissions, payouts and stats.",
  },
  {
    value: "write",
    label: "Read and make changes",
    detail:
      "Also invite and approve partners, draft campaigns and prepare payouts. A person still approves every payout here.",
  },
];

/** OAuth consent for MCP clients (server/oauth.ts). The person picks a workspace and an access level. */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const client = readClient(sp.client_id);
  if (!client || !sp.redirect_uri || !client.redirectUris.includes(sp.redirect_uri))
    return (
      <AuthCard title="This link doesn't work">
        <p className="text-[14px] leading-[22px] text-muted">
          The app that sent you here didn't register correctly. Go back to it and connect OpenPromoter again.
        </p>
      </AuthCard>
    );
  if (sp.response_type !== "code" || sp.code_challenge_method !== "S256" || !sp.code_challenge)
    redirect(callbackUrl(sp.redirect_uri, { error: "invalid_request", state: sp.state }));

  const { op_error: error, ...rest } = sp;
  const q = new URLSearchParams(rest as Record<string, string>).toString();
  const u = await requireUser(`/oauth/authorize?${q}`);
  const workspaces = new Map<string, { name: string; programs: string[] }>();
  for (const p of await userPrograms(u.id)) {
    if (!can(p.role, "developer.write")) continue;
    const w = workspaces.get(p.workspaceId) ?? { name: p.workspaceName, programs: [] };
    w.programs.push(p.name);
    workspaces.set(p.workspaceId, w);
  }
  if (!workspaces.size)
    return (
      <AuthCard title={`Connect ${client.name}`}>
        <p className="text-[14px] leading-[22px] text-muted">
          Only an owner or admin of a workspace can connect an AI app. Ask an owner to connect it or to change
          your role.
        </p>
      </AuthCard>
    );
  const wantsWrite = (sp.scope ?? "").split(" ").includes("write");

  return (
    <AuthCard
      title={`Connect ${client.name}`}
      subtitle={`${client.name} wants to use your OpenPromoter data. You're signed in as ${u.email}.`}
      footer={
        <>
          This creates an API key named &ldquo;{client.name} (MCP)&rdquo;. Revoke it any time in Settings &gt;
          API &amp; webhooks.
        </>
      }
    >
      <form action={authorizeAction} className="flex flex-col gap-6">
        <input type="hidden" name="q" value={q} />
        {error ? (
          <p role="alert" className="rounded-[10px] border border-border p-3 text-[13px] text-fg">
            {error}
          </p>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-medium text-fg">Workspace</legend>
          {[...workspaces].map(([id, w], i) => (
            <label
              key={id}
              className="flex cursor-pointer gap-3 rounded-[10px] border border-border p-3 has-[:checked]:border-fg"
            >
              <input type="radio" name="workspace" value={id} defaultChecked={i === 0} className="mt-1" />
              <span>
                <span className="block text-[14px] text-fg">{w.name}</span>
                {w.programs.join(", ") !== w.name ? (
                  <span className="block text-[13px] text-muted">{w.programs.join(", ")}</span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-medium text-fg">Access</legend>
          {ACCESS_OPTIONS.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer gap-3 rounded-[10px] border border-border p-3 has-[:checked]:border-fg"
            >
              <input
                type="radio"
                name="access"
                value={o.value}
                defaultChecked={(o.value === "write") === wantsWrite}
                className="mt-1"
              />
              <span>
                <span className="block text-[14px] text-fg">{o.label}</span>
                <span className="block text-[13px] text-muted">{o.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex gap-3">
          <Button type="submit" name="decision" value="allow" variant="primary" size="lg" className="flex-1">
            Allow
          </Button>
          <Button type="submit" name="decision" value="deny" size="lg" className="flex-1">
            Cancel
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
