"use client";

import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  Field,
  Input,
  Select,
  StatusBadge,
} from "@openpromoter/ui";
import { Ban, Check, Pause, UserPlus, Users, X } from "@openpromoter/ui/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { type Column, DataTable, type Tab } from "@/components/data-table";
import { mascotToast } from "@/components/mascot-toast";
import { formatMoney } from "@/lib/money";
import { invitePartnerAction, setPartnerStatusAction } from "../actions";

type Row = {
  id: string;
  name: string;
  email: string;
  status: string;
  code: string;
  riskScore: number;
  createdAt: string;
  group: string | null;
  revenue: number;
  earned: number;
  customers: number;
  country: string | null;
  source: string;
};

export function PartnersTable({
  programId,
  currency,
  rows,
  total,
  page,
  pageSize,
  tabs,
}: {
  programId: string;
  currency: string;
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  tabs: Tab[];
}) {
  const m = (n: number) => formatMoney(n, currency);
  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Partner",
      sortable: true,
      mobile: "title",
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={r.name} size={24} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-fg">{r.name}</span>
            <span className="block truncate text-xs text-subtle">{r.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "badge",
      render: (r) => <StatusBadge status={r.status === "approved" ? "active" : r.status} />,
    },
    {
      key: "group",
      header: "Tier",
      mobile: "meta",
      render: (r) => <span className="text-muted">{r.group ?? "–"}</span>,
    },
    {
      key: "customers",
      header: "Customers",
      align: "right",
      sortable: true,
      render: (r) => r.customers.toLocaleString("en-US"),
    },
    {
      key: "revenue",
      header: "Revenue",
      align: "right",
      sortable: true,
      mobile: "amount",
      render: (r) => m(r.revenue),
    },
    { key: "earned", header: "Earned", align: "right", sortable: true, render: (r) => m(r.earned) },
    {
      key: "risk",
      header: "Risk",
      align: "right",
      sortable: true,
      mobile: "meta",
      render: (r) =>
        r.riskScore >= 70 ? (
          <Badge tone="danger">{r.riskScore}</Badge>
        ) : r.riskScore >= 40 ? (
          <Badge tone="warning">{r.riskScore}</Badge>
        ) : (
          <span className="text-subtle">{r.riskScore}</span>
        ),
    },
    {
      key: "createdAt",
      header: "Joined",
      sortable: true,
      mobile: "meta",
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
      searchPlaceholder="Search name, email or code"
      rowHref={(r) => `/app/${programId}/partners/${r.id}`}
      exportHref={`/api/export/partners?program=${programId}`}
      bulk={[
        { label: "Approve", icon: Check, run: (ids) => setPartnerStatusAction(programId, ids, "approved") },
        { label: "Pause", icon: Pause, run: (ids) => setPartnerStatusAction(programId, ids, "paused") },
        { label: "Reject", icon: X, run: (ids) => setPartnerStatusAction(programId, ids, "rejected") },
        {
          label: "Ban",
          icon: Ban,
          danger: true,
          confirm: "Ban these partners? Their unpaid commissions will be held.",
          run: (ids) => setPartnerStatusAction(programId, ids, "banned"),
        },
      ]}
      empty={{
        icon: Users,
        title: "No partners yet",
        description:
          "Invite customers who already love your product or let the recruiter find partners for you.",
      }}
    />
  );
}

export function InviteButton({
  programId,
  groups,
  openByDefault,
}: {
  programId: string;
  groups: { id: string; name: string }[];
  openByDefault?: boolean;
}) {
  const [open, setOpen] = useState(!!openByDefault);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <UserPlus /> Invite partner
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Invite a partner"
        description="They're approved straight away and get an email with their link."
      >
        <form
          action={(f) =>
            start(async () => {
              const r = await invitePartnerAction(programId, {
                email: String(f.get("email")),
                name: String(f.get("name")),
                groupId: String(f.get("group") || "") || null,
              });
              if (!r.ok) return void toast.error(r.error);
              mascotToast("Invite sent", "refers");
              setOpen(false);
              router.push(`/app/${programId}/partners/${r.data}`);
            })
          }
          className="flex flex-col gap-4"
        >
          <Field label="Name" htmlFor="inv-name">
            <Input id="inv-name" name="name" required />
          </Field>
          <Field label="Email" htmlFor="inv-email">
            <Input id="inv-email" name="email" type="email" required />
          </Field>
          {groups.length > 1 ? (
            <Field label="Tier" htmlFor="inv-group">
              <Select id="inv-group" name="group" defaultValue={groups[0]?.id}>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
