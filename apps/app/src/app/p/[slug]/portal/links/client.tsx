"use client";

import { Badge, Button, Card, CardHeader, Field, Input, Tooltip } from "@openpromoter/ui";
import { Plus, QrCode } from "@openpromoter/ui/icons";
import { useState } from "react";
import { CopyButton } from "@/components/copy";
import { useAction } from "@/components/use-action";
import { formatNumber } from "@/lib/money";
import { partnerLinkAction } from "../../portal-actions";
import { QrDialog } from "../ticket";

type L = {
  id: string;
  url: string;
  destination: string;
  subId: string | null;
  label: string | null;
  clicks: number;
  customers: number;
};

const path = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");

function withParam(site: string, param: string, code: string) {
  try {
    const u = new URL(site);
    u.searchParams.set(param, code);
    return u.toString();
  } catch {
    return `${site}?${param}=${code}`;
  }
}

export function PartnerLinks({
  slug,
  website,
  param,
  code,
  direct,
  links,
}: {
  slug: string;
  website: string;
  appUrl: string;
  param: string;
  code: string;
  direct: { clicks: number; customers: number };
  links: L[];
}) {
  const viaUrl = withParam(website, param, code);
  const { pending, run } = useAction();
  const [qr, setQr] = useState<string | null>(null);
  return (
    <>
      <Card>
        <CardHeader
          title="Create a link"
          description="Point it at any page on the site. Add a sub-ID to see which channel works best."
        />
        <form
          className="grid gap-4 border-t border-border p-5 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end"
          action={(f) =>
            run(
              () =>
                partnerLinkAction(slug, {
                  destination: String(f.get("destination")),
                  subId: String(f.get("subId") || "") || undefined,
                }),
              "Link created",
            )
          }
        >
          <Field label="Destination page" htmlFor="ln-dest">
            <Input
              id="ln-dest"
              name="destination"
              type="url"
              defaultValue={website}
              required
              className="h-10"
            />
          </Field>
          <Field label="Sub-ID" htmlFor="ln-sub">
            <Input id="ln-sub" name="subId" placeholder="youtube" className="h-10 font-mono text-[12.5px]" />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={pending}>
            <Plus /> Create link
          </Button>
        </form>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Your links" description="Clicks and paying customers for each link you share." />
        <ul className="divide-y divide-border border-t border-border">
          <li className="hidden h-9 items-center gap-4 bg-surface-2 px-5 sm:flex" aria-hidden>
            <span className="eyebrow flex-1">Link</span>
            <span className="eyebrow w-16 text-right">Clicks</span>
            <span className="eyebrow w-20 text-right">Customers</span>
            <span className="w-[60px]" />
          </li>
          <LinkRow
            url={viaUrl}
            note="Any page on the site with your code. Coupon code sales count here too."
            clicks={direct.clicks}
            customers={direct.customers}
            onQr={setQr}
          />
          {links.map((l) => (
            <LinkRow
              key={l.id}
              url={l.url}
              subId={l.subId}
              note={`${l.label ? `${l.label} · ` : ""}to ${path(l.destination)}`}
              clicks={l.clicks}
              customers={l.customers}
              onQr={setQr}
            />
          ))}
        </ul>
      </Card>
      <QrDialog url={qr} onClose={() => setQr(null)} />
    </>
  );
}

function LinkRow(props: {
  url: string;
  subId?: string | null;
  note: string;
  clicks: number;
  customers: number;
  onQr: (url: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:flex-nowrap">
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[13px] text-fg">{props.url}</span>
          {props.subId ? <Badge className="h-5 font-mono text-[11px]">{props.subId}</Badge> : null}
        </div>
        <div className="mt-0.5 truncate text-xs text-subtle">{props.note}</div>
      </div>
      <span className="num text-[13px] text-fg sm:w-16 sm:text-right">
        {formatNumber(props.clicks)}
        <span className="text-subtle sm:hidden"> clicks</span>
      </span>
      <span className="num text-[13px] text-fg sm:w-20 sm:text-right">
        {formatNumber(props.customers)}
        <span className="text-subtle sm:hidden"> customers</span>
      </span>
      <span className="ml-auto flex items-center gap-1 sm:ml-0">
        <Tooltip content="QR code">
          <Button variant="ghost" size="icon-sm" aria-label="QR code" onClick={() => props.onQr(props.url)}>
            <QrCode />
          </Button>
        </Tooltip>
        <CopyButton value={props.url} label="Copy link" />
      </span>
    </li>
  );
}
