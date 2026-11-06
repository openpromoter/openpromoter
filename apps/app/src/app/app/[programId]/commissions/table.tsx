"use client";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  Field,
  Input,
  InputAdornment,
  Select,
  StatusBadge,
} from "@openpromoter/ui";
import { Check, Coins, PauseCircle, Play, Plus, Undo2 } from "@openpromoter/ui/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { type Column, DataTable, type Tab } from "@/components/data-table";
import { formatMoney } from "@/lib/money";
import { commissionBulkAction, manualCommissionAction } from "../actions";

type Row = {
  id: string;
  partnerId: string;
  partnerName: string;
  kind: string;
  description: string | null;
  saleAmount: number;
  amount: number;
  currency: string;
  status: string;
  heldReason: string | null;
  holdUntil: string | null;
  createdAt: string;
  payoutId: string | null;
  test: boolean;
};

export function CommissionsTable({
  programId,
  canWrite,
  rows,
  total,
  page,
  pageSize,
  tabs,
}: {
  programId: string;
  canWrite: boolean;
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  tabs: Tab[];
}) {
  const d = (s: string | null) =>
    s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "–";
  const money = (r: Row, n: number) =>
    n < 0 ? `−${formatMoney(-n, r.currency)}` : formatMoney(n, r.currency);
  const columns: Column<Row>[] = [
    {
      key: "partner",
      header: "Partner",
      mobile: "title",
      render: (r) => (
        <Link href={`/app/${programId}/partners/${r.partnerId}`} className="font-medium hover:underline">
          {r.partnerName}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      mobile: "badge",
      render: (r) => (
        <span className="inline-flex gap-1">
          <StatusBadge status={r.status} title={r.heldReason ?? undefined} />
          {r.test ? <Badge tone="info">Test</Badge> : null}
        </span>
      ),
    },
    {
      key: "what",
      header: "For",
      mobile: "meta",
      render: (r) => (
        <span className="block max-w-72 truncate text-muted" title={r.description ?? ""}>
          {r.description ?? r.kind}
        </span>
      ),
    },
    {
      key: "sale",
      header: "Sale",
      align: "right",
      render: (r) => (r.saleAmount ? money(r, r.saleAmount) : "–"),
    },
    {
      key: "amount",
      header: "Commission",
      align: "right",
      sortable: true,
      mobile: "amount",
      render: (r) => (
        <span
          className={
            r.amount < 0
              ? "text-danger"
              : r.status === "reversed"
                ? "text-subtle line-through"
                : "font-medium"
          }
        >
          {money(r, r.amount)}
        </span>
      ),
    },
    {
      key: "holdUntil",
      header: "Payable from",
      sortable: true,
      render: (r) => <span className="text-muted">{r.status === "pending" ? d(r.holdUntil) : "–"}</span>,
    },
    {
      key: "createdAt",
      header: "Date",
      sortable: true,
      mobile: "meta",
      render: (r) => <span className="text-muted">{d(r.createdAt)}</span>,
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
      searchPlaceholder="Search partner or description"
      exportHref={`/api/export/commissions?program=${programId}`}
      bulk={
        canWrite
          ? [
              {
                label: "Approve now",
                icon: Check,
                run: (ids) => commissionBulkAction(programId, "approve", ids),
              },
              {
                label: "Hold",
                icon: PauseCircle,
                run: (ids) => commissionBulkAction(programId, "hold", ids, "Held for review"),
              },
              { label: "Release", icon: Play, run: (ids) => commissionBulkAction(programId, "release", ids) },
              {
                label: "Reverse",
                icon: Undo2,
                danger: true,
                confirm: "Reverse these commissions? This can't be undone.",
                run: (ids) => commissionBulkAction(programId, "reverse", ids, "Reversed manually"),
              },
            ]
          : undefined
      }
      empty={{
        icon: Coins,
        title: "Commissions appear after your first referred sale",
        description:
          "Connect Stripe and install tracking. Every payment from a referred customer creates a commission here.",
        action: (
          <Button asChild variant="primary">
            <Link href={`/app/${programId}/settings/integrations`}>Connect Stripe</Link>
          </Button>
        ),
      }}
    />
  );
}

export function ManualCommission({
  programId,
  partners,
  currency,
}: {
  programId: string;
  partners: { id: string; name: string }[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add commission
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a commission"
        description="For bonuses, offline deals or corrections. Use a negative amount to deduct."
      >
        <form
          className="flex flex-col gap-4"
          action={(f) =>
            start(async () => {
              const r = await manualCommissionAction(programId, {
                partnerId: String(f.get("partner")),
                amount: String(f.get("amount")),
                description: String(f.get("description")),
              });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Commission added");
              setOpen(false);
              router.refresh();
            })
          }
        >
          <Field label="Partner" htmlFor="mc-partner">
            <Select id="mc-partner" name="partner" required>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="mc-amount">
            <InputAdornment prefix={currency.toUpperCase()}>
              <Input
                id="mc-amount"
                name="amount"
                inputMode="decimal"
                required
                pattern="-?\d+(\.\d{1,2})?"
                className="num pl-12 text-right"
              />
            </InputAdornment>
          </Field>
          <Field label="Reason" htmlFor="mc-desc">
            <Input id="mc-desc" name="description" required placeholder="Launch bonus" />
          </Field>
          <DialogFooter>
            <Button type="submit" variant="primary" loading={pending}>
              Add commission
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
