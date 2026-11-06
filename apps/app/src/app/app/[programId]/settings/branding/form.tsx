"use client";

import { Badge, Button, Field, Input, Select, Switch, Textarea } from "@openpromoter/ui";
import { CheckCircle2, ExternalLink, RefreshCw } from "@openpromoter/ui/icons";
import { useState } from "react";
import { CopyField } from "@/components/copy";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import {
  networkCategoryAction,
  networkListingAction,
  refreshBrandingAction,
  setDomainAction,
  updateBrandingAction,
  verifyDomainAction,
} from "../../settings-actions";

export function BrandingForm({
  programId,
  canWrite,
  brand,
  name,
  publicUrl,
  domain,
  verified,
  cnameTarget,
  autoHttps,
  listed,
  category,
  categories,
  isPublic,
  networkUrl,
}: {
  programId: string;
  canWrite: boolean;
  brand: { color: string; logoUrl: string; headline: string; description: string };
  name: string;
  publicUrl: string;
  domain: string | null;
  verified: boolean;
  cnameTarget: string;
  autoHttps: boolean;
  listed: boolean;
  category: string;
  categories: readonly string[];
  isPublic: boolean;
  networkUrl: string;
}) {
  const [b, setB] = useState(brand);
  const { pending, run } = useAction();
  return (
    <>
      <SettingsCard
        title="Partner portal branding"
        description="Your logo and color on the program page, application form and partner portal. Pulled from your website; adjust if needed."
        footer={
          canWrite ? (
            <>
              <Button
                variant="ghost"
                loading={pending}
                onClick={() => run(() => refreshBrandingAction(programId))}
              >
                <RefreshCw /> Pull from my site
              </Button>
              <Button
                variant="primary"
                loading={pending}
                onClick={() => run(() => updateBrandingAction(programId, b))}
              >
                Save
              </Button>
            </>
          ) : null
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand color" htmlFor="br-color">
            <div className="flex gap-2">
              <input
                type="color"
                value={b.color}
                onChange={(e) => setB({ ...b, color: e.target.value })}
                aria-label="Pick color"
                disabled={!canWrite}
                className="h-8 w-10 cursor-pointer rounded-sm border border-border bg-surface"
              />
              <Input
                id="br-color"
                value={b.color}
                onChange={(e) => setB({ ...b, color: e.target.value })}
                className="font-mono"
                disabled={!canWrite}
              />
            </div>
          </Field>
          <Field label="Logo URL" htmlFor="br-logo">
            <Input
              id="br-logo"
              value={b.logoUrl}
              onChange={(e) => setB({ ...b, logoUrl: e.target.value })}
              disabled={!canWrite}
            />
          </Field>
        </div>
        <Field label="Headline" htmlFor="br-head">
          <Input
            id="br-head"
            value={b.headline}
            onChange={(e) => setB({ ...b, headline: e.target.value })}
            disabled={!canWrite}
          />
        </Field>
        <Field label="Description" htmlFor="br-desc">
          <Textarea
            id="br-desc"
            value={b.description}
            onChange={(e) => setB({ ...b, description: e.target.value })}
            disabled={!canWrite}
          />
        </Field>
        <div className="rounded-md border border-border p-4">
          <div className="mb-2 text-xs text-muted">Preview</div>
          <div className="flex items-center gap-3">
            {/^https?:\/\//i.test(b.logoUrl ?? "") ? (
              <img src={b.logoUrl!} alt="" className="size-8 rounded-sm object-contain" />
            ) : null}
            <span className="font-medium text-fg">{name}</span>
            <span
              className="ml-auto rounded-sm px-3 py-1.5 text-[13px] font-medium"
              style={{ background: b.color, color: "#fff" }}
            >
              Join the program
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent-text hover:underline"
          >
            Open program page <ExternalLink className="size-3" />
          </a>
        </div>
      </SettingsCard>
      <SettingsCard
        title="Custom domain"
        description={`Host the program page and portal on your own domain such as partners.yourapp.com. Add a CNAME record pointing to ${cnameTarget}.`}
      >
        <form
          className="flex gap-2"
          action={(f) => run(() => setDomainAction(programId, String(f.get("domain"))))}
        >
          <Input
            name="domain"
            defaultValue={domain ?? ""}
            placeholder="partners.yourapp.com"
            aria-label="Domain"
            disabled={!canWrite}
          />
          <Button type="submit" loading={pending} disabled={!canWrite}>
            Save
          </Button>
        </form>
        {domain ? (
          <div className="flex flex-col gap-3 rounded-md border border-border p-4 text-[13px]">
            <div className="grid grid-cols-[80px_1fr] items-center gap-2">
              <span className="text-muted">Type</span>
              <span className="font-mono">CNAME</span>
              <span className="text-muted">Name</span>
              <CopyField value={domain} />
              <span className="text-muted">Value</span>
              <CopyField value={cnameTarget} />
            </div>
            {verified ? (
              <Badge tone="success" icon={CheckCircle2} className="self-start">
                Verified
              </Badge>
            ) : (
              <Button
                className="self-start"
                loading={pending}
                onClick={() => run(() => verifyDomainAction(programId))}
              >
                {autoHttps ? "Check DNS and HTTPS" : "Verify DNS"}
              </Button>
            )}
            <p className="text-xs text-muted">
              {autoHttps
                ? "We issue and renew the HTTPS certificate for you once the record is live."
                : "Self-hosting? Your reverse proxy also needs a TLS certificate for this domain (Caddy and Traefik do this automatically)."}
            </p>
          </div>
        ) : null}
      </SettingsCard>
      <SettingsCard
        title="Partner marketplace"
        description="List your program in the public marketplace. Partners can filter by category and apply in one click."
      >
        <label className="flex items-center justify-between gap-4">
          <span className="text-[13px] text-fg">
            Show in the marketplace ·{" "}
            <a
              href={networkUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent-text hover:underline"
            >
              view marketplace
            </a>
          </span>
          <Switch
            checked={listed}
            disabled={!canWrite}
            onCheckedChange={(v) => run(() => networkListingAction(programId, v))}
            aria-label="List in partner marketplace"
          />
        </label>
        <Field label="Category" htmlFor="category" hint="Partners filter the marketplace by category.">
          <Select
            id="category"
            value={category || "none"}
            disabled={!canWrite}
            onValueChange={(v) => run(() => networkCategoryAction(programId, v === "none" ? "" : v))}
          >
            <option value="none">No category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        {listed && !isPublic ? (
          <p className="text-xs text-warning">
            Only public programs appear in the marketplace. Set visibility to Public under Program.
          </p>
        ) : null}
      </SettingsCard>
    </>
  );
}
