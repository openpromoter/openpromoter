"use client";

import { Button, Card, CardBody, CardHeader, Field, Input, Select } from "@openpromoter/ui";
import { Download, ExternalLink, Trophy } from "@openpromoter/ui/icons";
import { CopyButton } from "@/components/copy";
import { useAction } from "@/components/use-action";
import { formatMoney } from "@/lib/money";
import { submitBountyAction } from "../../portal-actions";

export function PartnerContent({
  slug,
  assets,
  resources,
  bounties,
  currency,
  focusBounty,
}: {
  slug: string;
  assets: { id: string; kind: string; title: string; body: string }[];
  resources: {
    id: string;
    title: string;
    url: string;
    description: string | null;
    fileName: string | null;
  }[];
  bounties: { id: string; name: string; reward: number }[];
  currency: string;
  focusBounty: string | null;
}) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-col gap-4">
      {bounties.length ? (
        <Card id="bounty">
          <CardHeader
            title="Submit a post for a bounty"
            description="Share the URL of your post or video. It's paid once the team approves it."
            action={<Trophy className="size-5 text-subtle" />}
          />
          <CardBody>
            <form
              className="grid gap-4 sm:grid-cols-[220px_minmax(0,1fr)_auto] sm:items-end"
              action={(f) =>
                run(
                  () => submitBountyAction(slug, String(f.get("campaign")), String(f.get("url"))),
                  "Submitted",
                )
              }
            >
              <Field label="Bounty" htmlFor="bn-campaign">
                <Select
                  id="bn-campaign"
                  name="campaign"
                  defaultValue={focusBounty ?? bounties[0]!.id}
                  className="h-10"
                >
                  {bounties.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({formatMoney(b.reward, currency)})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Post URL" htmlFor="bn-url">
                <Input id="bn-url" name="url" type="url" placeholder="https://" required className="h-10" />
              </Field>
              <Button type="submit" variant="primary" size="lg" loading={pending}>
                Submit post
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}
      <div className="grid items-start gap-4 md:grid-cols-2">
        {assets
          .filter((a) => a.kind !== "banner")
          .map((a) => (
            <Card key={a.id} className="flex flex-col">
              <div className="flex items-center justify-between gap-3 px-5 pt-4">
                <span className="eyebrow">{a.kind.replace(/_/g, " ")}</span>
                <CopyButton value={a.body} label="Copy text" />
              </div>
              <h3 className="px-5 pt-1 text-[15px] font-medium tracking-[-0.01em] text-fg">{a.title}</h3>
              <p className="m-5 mt-3 rounded-lg border border-border bg-surface-2/70 px-4 py-3 text-[13px] leading-6 whitespace-pre-wrap text-fg dark:bg-surface-2">
                {a.body}
              </p>
            </Card>
          ))}
      </div>
      {assets.some((a) => a.kind === "banner") ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {assets
            .filter((a) => a.kind === "banner")
            .map((a) => (
              <Card key={a.id} className="overflow-hidden">
                <div className="flex h-36 items-center justify-center border-b border-border bg-canvas bg-[radial-gradient(var(--dot)_1px,transparent_1.2px)] bg-[length:8px_8px] p-3 dark:bg-surface-2">
                  <img src={`/api/banner/${a.id}`} alt={a.title} className="max-h-full max-w-full" />
                </div>
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                  <span className="truncate text-fg">{a.title}</span>
                  <a
                    href={`/api/banner/${a.id}?download=1`}
                    className="-my-2 inline-flex shrink-0 items-center gap-1 py-2 text-xs font-medium text-accent-text hover:underline"
                  >
                    <Download className="size-3.5" /> Download
                  </a>
                </div>
              </Card>
            ))}
        </div>
      ) : null}
      {resources.length ? (
        <Card>
          <CardHeader title="Resources" description="Files, guides and pages the team recommends." />
          <ul className="divide-y divide-border border-t border-border">
            {resources.map((r) => (
              <li key={r.id} className="px-5 py-3 text-[13px]">
                <a
                  href={r.fileName ? `${r.url}?download` : r.url}
                  target={r.fileName ? undefined : "_blank"}
                  rel="noreferrer noopener"
                  className="flex items-center gap-2 text-fg hover:underline"
                >
                  {r.fileName ? (
                    <Download className="size-4 text-subtle" />
                  ) : (
                    <ExternalLink className="size-4 text-subtle" />
                  )}
                  {r.title}
                </a>
                {r.description ? <p className="mt-0.5 text-xs text-muted">{r.description}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
