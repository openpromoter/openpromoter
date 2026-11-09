"use client";

import { Badge, type BadgeTone } from "@openpromoter/ui";
import { History, Layers, Users, UsersRound, Webhook } from "@openpromoter/ui/icons";
import { type Column, DataTable, type Tab } from "@/components/data-table";
import { formatMoney } from "@/lib/money";

/** The admin console's list tables (server pages pass plain rows; dates as ISO strings). */
const when = (s: string | null) =>
  s
    ? new Date(s).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "–";
const date = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "–";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replaceAll("_", " ");
const TONE: Record<string, BadgeTone> = {
  approved: "success",
  pending: "warning",
  rejected: "neutral",
  paused: "neutral",
};
type Paged = { total: number; page: number; pageSize: number; tabs?: Tab[] };

export type PartnerRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  country: string | null;
  joined: string;
  program: string;
  currency: string;
  workspaceId: string;
  earned: number;
};
export function PartnersTable({ rows, ...p }: { rows: PartnerRow[] } & Paged) {
  const columns: Column<PartnerRow>[] = [
    {
      key: "name",
      header: "Partner",
      mobile: "title",
      render: (r) => (
        <span className="block max-w-72 min-w-0">
          <span className="block truncate font-medium text-fg">{r.name}</span>
          <span className="block truncate text-xs text-subtle">
            {r.email}
            {r.country ? ` · ${r.country}` : ""}
          </span>
        </span>
      ),
    },
    { key: "program", header: "Program", render: (r) => <span className="text-muted">{r.program}</span> },
    {
      key: "status",
      header: "Status",
      mobile: "badge",
      render: (r) => <Badge tone={TONE[r.status] ?? "neutral"}>{cap(r.status)}</Badge>,
    },
    { key: "joined", header: "Joined", render: (r) => <span className="text-muted">{date(r.joined)}</span> },
    {
      key: "earned",
      header: "Earned",
      align: "right",
      mobile: "amount",
      render: (r) => <span className="num">{formatMoney(r.earned, r.currency)}</span>,
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      {...p}
      rowHref={(r) => `/admin/w/${r.workspaceId}`}
      searchPlaceholder="Search by email or name"
      empty={{
        icon: UsersRound,
        title: "No partners match",
        description: "Search by the start of an email or name.",
      }}
    />
  );
}

export type UserRow = {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  twoFactor: boolean;
  createdAt: string;
  methods: string;
  lastActive: string | null;
  workspaceId: string | null;
  workspaces: number;
  partnerOf: number;
};
const METHOD: Record<string, string> = { credential: "Password", google: "Google", github: "GitHub" };
export function UsersTable({ rows, ...p }: { rows: UserRow[] } & Paged) {
  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Person",
      mobile: "title",
      render: (r) => (
        <span className="block max-w-72 min-w-0">
          <span className="block truncate font-medium text-fg">{r.name}</span>
          <span className="block truncate text-xs text-subtle">{r.email}</span>
        </span>
      ),
    },
    {
      key: "role",
      header: "Is a",
      mobile: "badge",
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.workspaces ? <Badge tone="info">Founder</Badge> : null}
          {r.partnerOf ? (
            <Badge tone="neutral">{r.partnerOf > 1 ? `Partner in ${r.partnerOf}` : "Partner"}</Badge>
          ) : null}
          {!r.workspaces && !r.partnerOf ? <span className="text-subtle">No account yet</span> : null}
        </span>
      ),
    },
    {
      key: "signin",
      header: "Signs in with",
      render: (r) => (
        <span className="text-muted">
          {r.methods
            .split(",")
            .filter(Boolean)
            .map((m) => METHOD[m] ?? cap(m))
            .join(", ") || "–"}
          {r.twoFactor ? " · 2FA" : ""}
        </span>
      ),
    },
    {
      key: "verified",
      header: "Email",
      render: (r) =>
        r.verified ? (
          <span className="text-muted">Verified</span>
        ) : (
          <Badge tone="warning">Not verified</Badge>
        ),
    },
    {
      key: "active",
      header: "Last active",
      render: (r) => <span className="text-muted">{when(r.lastActive)}</span>,
    },
    {
      key: "created",
      header: "Joined",
      render: (r) => <span className="text-muted">{date(r.createdAt)}</span>,
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      {...p}
      rowHref={(r) =>
        r.workspaceId ? `/admin/w/${r.workspaceId}` : `/admin/partners?q=${encodeURIComponent(r.email)}`
      }
      searchPlaceholder="Search by email or name"
      empty={{
        icon: Users,
        title: "No people match",
        description: "Search by the start of an email or name.",
      }}
    />
  );
}

export type JobRow = {
  id: string;
  name: string;
  runAt: string;
  doneAt: string | null;
  failedAt: string | null;
  attempts: number;
  maxAttempts: number;
  error: string | null;
};
export function JobsTable({ rows, ...p }: { rows: JobRow[] } & Paged) {
  const columns: Column<JobRow>[] = [
    {
      key: "name",
      header: "Job",
      mobile: "title",
      render: (r) => <span className="font-mono text-xs text-fg">{r.name}</span>,
    },
    {
      key: "state",
      header: "State",
      mobile: "badge",
      render: (r) =>
        r.failedAt ? (
          <Badge tone="danger">Failed</Badge>
        ) : r.doneAt ? (
          <Badge tone="success">Done</Badge>
        ) : (
          <Badge tone={new Date(r.runAt).getTime() < Date.now() - 5 * 60_000 ? "warning" : "neutral"}>
            Waiting
          </Badge>
        ),
    },
    {
      key: "attempts",
      header: "Tries",
      align: "right",
      render: (r) => <span className="num">{`${r.attempts}/${r.maxAttempts}`}</span>,
    },
    {
      key: "when",
      header: "When",
      mobile: "meta",
      render: (r) => <span className="text-muted">{when(r.failedAt ?? r.doneAt ?? r.runAt)}</span>,
    },
    {
      key: "error",
      header: "Error",
      render: (r) => (
        <span className="block max-w-[420px] truncate text-xs text-subtle" title={r.error ?? ""}>
          {r.error ?? "–"}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      {...p}
      empty={{ icon: Layers, title: "Nothing here", description: "Background work shows up as it runs." }}
    />
  );
}

export type HookRow = {
  id: string;
  event: string;
  at: string;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  url: string;
  kind: string;
  workspaceId: string;
  workspace: string;
};
export function WebhooksTable({ rows, ...p }: { rows: HookRow[] } & Paged) {
  const columns: Column<HookRow>[] = [
    {
      key: "workspace",
      header: "Workspace",
      mobile: "title",
      render: (r) => (
        <span className="block max-w-72 min-w-0">
          <span className="block truncate font-medium text-fg">{r.workspace}</span>
          <span className="block truncate text-xs text-subtle">{r.url}</span>
        </span>
      ),
    },
    { key: "event", header: "Event", render: (r) => <span className="font-mono text-xs">{r.event}</span> },
    {
      key: "result",
      header: "Answer",
      mobile: "badge",
      render: (r) => (
        <Badge tone="danger">{r.responseStatus ? `HTTP ${r.responseStatus}` : "No answer"}</Badge>
      ),
    },
    {
      key: "tries",
      header: "Tries",
      align: "right",
      render: (r) => <span className="num">{r.attempts}</span>,
    },
    {
      key: "at",
      header: "When",
      mobile: "meta",
      render: (r) => <span className="text-muted">{when(r.at)}</span>,
    },
    {
      key: "error",
      header: "Error",
      render: (r) => (
        <span className="block max-w-[320px] truncate text-xs text-subtle" title={r.error ?? ""}>
          {r.error ?? "–"}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      {...p}
      rowHref={(r) => `/admin/w/${r.workspaceId}`}
      empty={{
        icon: Webhook,
        title: "No failed deliveries",
        description: "Every founder's webhooks answered in the last 7 days.",
      }}
    />
  );
}

export type ActivityRow = {
  id: string;
  at: string;
  action: string;
  actorType: string;
  workspaceId: string;
  workspace: string | null;
  summary: string;
};
export function ActivityTable({ rows, ...p }: { rows: ActivityRow[] } & Paged) {
  const columns: Column<ActivityRow>[] = [
    {
      key: "at",
      header: "When",
      mobile: "meta",
      render: (r) => <span className="text-muted">{when(r.at)}</span>,
    },
    {
      key: "workspace",
      header: "Workspace",
      mobile: "title",
      render: (r) => (
        <span className="block max-w-60 truncate font-medium text-fg">
          {r.workspace ?? "Deleted workspace"}
        </span>
      ),
    },
    {
      key: "action",
      header: "What happened",
      render: (r) => (
        <span className="block min-w-0">
          <span className="font-mono text-xs text-fg">{r.action}</span>
          {r.summary ? (
            <span className="block max-w-[420px] truncate text-xs text-subtle">{r.summary}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "by",
      header: "By",
      mobile: "badge",
      render: (r) => <span className="text-muted">{cap(r.actorType.replace("api_key", "API key"))}</span>,
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      {...p}
      rowHref={(r) => `/admin/w/${r.workspaceId}`}
      empty={{ icon: History, title: "No activity", description: "Changes in every workspace appear here." }}
    />
  );
}
