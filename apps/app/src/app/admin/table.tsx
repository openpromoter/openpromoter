"use client";

import { Badge } from "@openpromoter/ui";
import { UsersRound } from "@openpromoter/ui/icons";
import { type Column, DataTable, type Tab } from "@/components/data-table";
import { formatMoney } from "@/lib/money";
import { BILLING_TONE, billingLabel } from "@/server/admin-labels";

type Row = {
  id: string;
  name: string;
  owner: string | null;
  plan: string;
  status: string | null;
  paying: boolean;
  done: number;
  partners: number;
  usage: number;
  usageShare: number;
  lastActive: string | null;
  createdAt: string;
  flags: string[];
};

const ago = (s: string | null) => {
  if (!s) return "Never";
  const days = Math.floor((Date.now() - new Date(s).getTime()) / 86_400_000);
  return days < 1 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
};

export function WorkspacesTable({
  rows,
  total,
  page,
  pageSize,
  tabs,
}: {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  tabs: Tab[];
}) {
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Workspace",
      mobile: "title",
      render: (r) => (
        <span className="block max-w-72 min-w-0">
          <span className="block truncate font-medium text-fg">{r.name}</span>
          <span className="block truncate text-xs text-subtle">{r.owner ?? "No owner"}</span>
        </span>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      mobile: "badge",
      render: (r) => (
        <span className="flex items-center gap-2">
          <span className="text-fg">{r.plan}</span>
          {r.status && r.status !== "active" ? (
            <Badge tone={BILLING_TONE[r.status] ?? "neutral"}>{billingLabel(r.status)}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "setup",
      header: "Setup",
      mobile: "meta",
      render: (r) => (
        <span className="flex items-center gap-2" title={`${r.done} of 6 steps`}>
          <span className="flex gap-0.5" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={`h-2.5 w-1.5 ${i < r.done ? "bg-accent" : "bg-border-strong"}`} />
            ))}
          </span>
          <span className="num text-xs text-subtle">{r.done}/6</span>
        </span>
      ),
    },
    {
      key: "partners",
      header: "Partners",
      align: "right",
      render: (r) => <span className="num">{r.partners}</span>,
    },
    {
      key: "usage",
      header: "Revenue this month",
      align: "right",
      mobile: "amount",
      render: (r) => (
        <span className="num">
          {formatMoney(r.usage, "usd")}
          <span className="ml-1.5 text-xs text-subtle">{Math.round(r.usageShare * 100)}%</span>
        </span>
      ),
    },
    {
      key: "active",
      header: "Last active",
      render: (r) => <span className="text-muted">{ago(r.lastActive)}</span>,
    },
    {
      key: "flags",
      header: "Needs you",
      render: (r) =>
        r.flags.length ? (
          <Badge tone="warning" title={r.flags.join(" · ")}>
            {r.flags[0]}
            {r.flags.length > 1 ? ` +${r.flags.length - 1}` : ""}
          </Badge>
        ) : (
          <span className="text-subtle">–</span>
        ),
    },
    {
      key: "created",
      header: "Joined",
      render: (r) => (
        <span className="text-muted">
          {new Date(r.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      total={total}
      page={page}
      pageSize={pageSize}
      tabs={tabs}
      rowHref={(r) => `/admin/w/${r.id}`}
      searchPlaceholder="Search workspaces"
      empty={{ icon: UsersRound, title: "No workspaces match", description: "Try another search or tab." }}
    />
  );
}
