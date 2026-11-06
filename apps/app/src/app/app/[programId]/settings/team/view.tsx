"use client";

import { Avatar, Badge, Button, Card, CardBody, CardHeader, Input, Select } from "@openpromoter/ui";
import { useAction } from "@/components/use-action";
import { inviteMemberAction, setMemberRoleAction } from "../../settings-actions";

const ROLES = [
  ["owner", "Owner", "Everything including billing"],
  ["admin", "Admin", "Everything except billing"],
  ["finance", "Finance", "Commissions and payouts"],
  ["viewer", "Viewer", "Read only"],
] as const;
const roleName = (r: string) => ROLES.find(([v]) => v === r)?.[1] ?? r;

export function TeamView({
  programId,
  me,
  canWrite,
  members,
  invites,
}: {
  programId: string;
  me: string;
  canWrite: boolean;
  members: { id: string; name: string; email: string; role: string; twoFactor: boolean }[];
  invites: { id: string; email: string; role: string }[];
}) {
  const { pending, run } = useAction();
  return (
    <>
      {canWrite ? (
        <Card>
          <CardHeader title="Invite a teammate" />
          <CardBody>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              action={(f) =>
                run(() =>
                  inviteMemberAction(programId, {
                    email: String(f.get("email")),
                    role: String(f.get("role")) as "admin",
                  }),
                )
              }
            >
              <Input
                name="email"
                type="email"
                placeholder="teammate@company.com"
                aria-label="Email"
                required
              />
              <Select name="role" defaultValue="admin" aria-label="Role" className="sm:w-64">
                {ROLES.map(([v, l, d]) => (
                  <option key={v} value={v}>
                    {l}: {d.toLowerCase()}
                  </option>
                ))}
              </Select>
              <Button type="submit" variant="primary" loading={pending}>
                Send invite
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader
          title="Members"
          description={`${members.length} member${members.length === 1 ? "" : "s"}${invites.length ? ` and ${invites.length} pending invite${invites.length === 1 ? "" : "s"}` : ""}`}
        />
        <ul className="divide-y divide-border border-t border-border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]">
              <Avatar name={m.name} size={28} />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-fg">
                  {m.name}
                  {m.id === me ? " (you)" : ""}
                </div>
                <div className="truncate text-xs text-subtle">{m.email}</div>
              </div>
              {m.twoFactor ? <Badge tone="success">2FA on</Badge> : <Badge tone="neutral">No 2FA</Badge>}
              {canWrite && m.id !== me ? (
                <Select
                  value={m.role}
                  aria-label={`Role for ${m.name}`}
                  className="w-36"
                  onValueChange={(v) => run(() => setMemberRoleAction(programId, m.id, v as "admin"))}
                >
                  {ROLES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                  <option value="remove">Remove</option>
                </Select>
              ) : (
                <span className="w-36 px-3 text-[13px] text-muted">{roleName(m.role)}</span>
              )}
            </li>
          ))}
          {invites.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
              <Avatar name={i.email} size={28} />
              <span className="flex-1 text-muted">{i.email}</span>
              <Badge tone="neutral">Invited</Badge>
              <span className="w-36 px-3 text-[13px] text-muted">{roleName(i.role)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Roles" description="What each role can do in every program in this workspace" />
        <dl className="border-t border-border px-5 py-3">
          {ROLES.map(([v, l, d]) => (
            <div key={v} className="flex items-center py-1.5 text-[13px]">
              <dt className="text-fg">{l}</dt>
              <span className="leader" aria-hidden />
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
