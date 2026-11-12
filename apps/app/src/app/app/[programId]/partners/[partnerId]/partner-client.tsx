"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  Input,
  Select,
  Textarea,
} from "@openpromoter/ui";
import { Ban, Check, ChevronDown, MessageSquare, Pause, Plus, QrCode, Ticket } from "@openpromoter/ui/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CopyButton } from "@/components/copy";
import type { ActionResult } from "@/server/context";
import {
  anonymizePartnerAction,
  createLinkAction,
  createPromoAction,
  setPartnerStatusAction,
  updatePartnerAction,
} from "../../actions";

function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, ok?: string, after?: (d: T | undefined) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? ok ?? "Done");
      after?.(r.data);
      router.refresh();
    });
  return { pending, run };
}

export function PartnerActions({
  programId,
  partnerId,
  status,
}: {
  programId: string;
  partnerId: string;
  status: string;
}) {
  const { pending, run } = useAction();
  const set = (s: "approved" | "paused" | "banned" | "rejected") =>
    run(
      () => setPartnerStatusAction(programId, [partnerId], s),
      s === "approved" ? "Partner approved" : `Partner ${s}`,
    );
  return (
    <div className="flex flex-wrap gap-2">
      {status === "pending" ? (
        <>
          <Button variant="primary" loading={pending} onClick={() => set("approved")}>
            <Check /> Approve
          </Button>
          <Button variant="secondary" onClick={() => set("rejected")}>
            Reject
          </Button>
        </>
      ) : null}
      <Button asChild variant="secondary">
        <Link href={`/app/${programId}/messages?partner=${partnerId}`}>
          <MessageSquare /> Message
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" aria-label="More actions">
            More <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {status !== "approved" ? (
            <DropdownMenuItem onSelect={() => set("approved")}>
              <Check /> Approve / reactivate
            </DropdownMenuItem>
          ) : null}
          {status === "approved" ? (
            <DropdownMenuItem onSelect={() => set("paused")}>
              <Pause /> Pause
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            danger
            onSelect={() =>
              window.confirm("Ban this partner? Unpaid commissions will be held.") && set("banned")
            }
          >
            <Ban /> Ban
          </DropdownMenuItem>
          <DropdownMenuItem
            danger
            onSelect={() =>
              window.confirm(
                "Erase this partner's personal data (GDPR)? Commissions and payouts stay in the ledger. This can't be undone.",
              ) && run(() => anonymizePartnerAction(programId, partnerId), "Personal data erased")
            }
          >
            <Ban /> Erase personal data
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type L = {
  id: string;
  key: string;
  destination: string;
  subId: string | null;
  label: string | null;
  clicks: number;
};

export function LinksCard({
  programId,
  partnerId,
  slug,
  code,
  appUrl,
  domain,
  website,
  param,
  links,
}: {
  programId: string;
  partnerId: string;
  slug: string;
  code: string;
  appUrl: string;
  /** The verified custom domain origin: links show as partners.acme.com/key. */
  domain: string | null;
  website: string;
  param: string;
  links: L[];
}) {
  const [open, setOpen] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const { pending, run } = useAction();
  const direct = `${website.replace(/\/$/, "")}/?${param}=${code}`;
  const all = [
    {
      id: "direct",
      key: "",
      destination: website,
      subId: null,
      label: `Direct link (?${param}=)`,
      clicks: -1,
      url: direct,
    },
    ...links.map((l) => ({ ...l, url: domain ? `${domain}/${l.key}` : `${appUrl}/r/${slug}/l/${l.key}` })),
  ];
  return (
    <Card>
      <CardHeader
        title="Links"
        description="Short links, deep links and sub-IDs. Every link works with first-party cookies and server-side Stripe attribution."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus /> New link
              </Button>
            </DialogTrigger>
            <DialogContent
              title="Create a link"
              description="Point to any page on your site. Add a sub-ID to track where the partner shares it."
            >
              <form
                className="flex flex-col gap-4"
                action={(f) =>
                  run(
                    () =>
                      createLinkAction(programId, partnerId, {
                        destination: String(f.get("destination")),
                        subId: String(f.get("subId") || ""),
                        label: String(f.get("label") || ""),
                        key: String(f.get("key") || ""),
                      }),
                    "Link created",
                    () => setOpen(false),
                  )
                }
              >
                <Field label="Destination" htmlFor="ln-dest">
                  <Input id="ln-dest" name="destination" type="url" defaultValue={website} required />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Sub-ID" htmlFor="ln-sub" hint="e.g. youtube, newsletter">
                    <Input id="ln-sub" name="subId" />
                  </Field>
                  <Field label="Custom slug" htmlFor="ln-key" hint="Optional">
                    <Input id="ln-key" name="key" />
                  </Field>
                </div>
                <Field label="Label" htmlFor="ln-label">
                  <Input id="ln-label" name="label" />
                </Field>
                <DialogFooter>
                  <Button type="submit" variant="primary" loading={pending}>
                    Create link
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />
      <ul className="divide-y divide-border border-t border-border">
        {all.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[12.5px] text-fg">{l.url}</div>
              <div className="truncate text-xs text-subtle">
                {l.label ?? "Link"} → {l.destination}
                {l.subId ? ` · sub ${l.subId}` : ""}
              </div>
            </div>
            {l.clicks >= 0 ? <span className="num text-xs text-muted">{l.clicks} clicks</span> : null}
            <Button variant="ghost" size="icon-sm" aria-label="Show QR code" onClick={() => setQr(l.url)}>
              <QrCode />
            </Button>
            <CopyButton value={l.url} label="Copy link" />
          </li>
        ))}
      </ul>
      <Dialog open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent title="QR code" description={qr ?? ""}>
          {qr ? (
            <div className="flex flex-col items-center gap-3">
              <img
                src={`/api/qr?url=${encodeURIComponent(qr)}`}
                alt="QR code for the link"
                width={220}
                height={220}
                className="rounded-md border border-border bg-white p-2"
              />
              <Button asChild variant="secondary" size="sm">
                <a href={`/api/qr?url=${encodeURIComponent(qr)}&download=1`} download="qr.svg">
                  Download SVG
                </a>
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function PromoCard({
  programId,
  partnerId,
  codes,
}: {
  programId: string;
  partnerId: string;
  codes: { id: string; code: string; synced: boolean }[];
}) {
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader
        title="Coupon codes"
        description="Sales with these codes are credited to this partner even without a click."
      />
      <CardBody className="flex flex-col gap-3">
        {codes.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded-sm border border-border px-3 py-1.5"
          >
            <span className="flex items-center gap-2 font-mono text-[13px] text-fg">
              <Ticket className="size-4 text-muted" /> {c.code}
            </span>
            <span className="text-xs text-subtle">{c.synced ? "Created in Stripe" : "Tracking only"}</span>
          </div>
        ))}
        <form
          className="flex flex-col gap-2"
          action={(f) =>
            run(
              () =>
                createPromoAction(programId, partnerId, {
                  code: String(f.get("code")),
                  couponId: String(f.get("coupon") || "") || undefined,
                }),
              "Code added",
            )
          }
        >
          <div className="flex gap-2">
            <Input
              name="code"
              placeholder="PARTNER20"
              aria-label="Code"
              required
              className="font-mono uppercase placeholder:font-sans placeholder:normal-case"
            />
            <Button type="submit" loading={pending}>
              Add
            </Button>
          </div>
          <Input
            name="coupon"
            placeholder="Stripe coupon id (optional)"
            aria-label="Stripe coupon id"
            className="font-mono placeholder:font-sans"
          />
        </form>
      </CardBody>
    </Card>
  );
}

export function PartnerSettings({
  programId,
  partnerId,
  groups,
  groupId,
  notes,
  payoutMethod,
  paypalEmail,
  override,
  unit,
}: {
  programId: string;
  partnerId: string;
  groups: { id: string; name: string; rate: number | null }[];
  groupId: string | null;
  notes: string | null;
  payoutMethod: string | null;
  paypalEmail: string | null;
  override: string;
  unit: string;
}) {
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader title="Tier and notes" />
      <CardBody>
        <form
          className="flex flex-col gap-4"
          action={(f) =>
            run(
              () =>
                updatePartnerAction(programId, partnerId, {
                  groupId: String(f.get("group") || "") || null,
                  notes: String(f.get("notes") ?? ""),
                  payoutMethod: (String(f.get("payoutMethod") || "") || null) as "manual" | null,
                  paypalEmail: String(f.get("paypal") || "") || null,
                  rate: String(f.get("rate") ?? ""),
                }),
              "Saved",
            )
          }
        >
          <Field label="Tier" htmlFor="ps-group">
            <Select id="ps-group" name="group" defaultValue={groupId ?? ""}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.rate != null ? ` (${g.rate / 100}%)` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={`Custom rate (${unit})`}
            htmlFor="ps-rate"
            hint="Overrides the tier rate for this partner only. Leave empty to use the tier."
          >
            <Input id="ps-rate" name="rate" defaultValue={override} inputMode="decimal" className="num" />
          </Field>
          <Field label="Payout method" htmlFor="ps-method">
            <Select id="ps-method" name="payoutMethod" defaultValue={payoutMethod ?? ""}>
              <option value="">Let the partner choose</option>
              <option value="stripe">Stripe</option>
              <option value="paypal">PayPal</option>
              <option value="wise">Wise</option>
              <option value="manual">Manual / bank transfer</option>
            </Select>
          </Field>
          <Field label="PayPal email" htmlFor="ps-paypal">
            <Input id="ps-paypal" name="paypal" type="email" defaultValue={paypalEmail ?? ""} />
          </Field>
          <Field label="Private notes" htmlFor="ps-notes">
            <Textarea id="ps-notes" name="notes" defaultValue={notes ?? ""} />
          </Field>
          <Button type="submit" loading={pending} className="self-end">
            Save
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
