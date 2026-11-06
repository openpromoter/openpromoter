"use client";

import { Avatar } from "@openpromoter/ui";
import { Banknote, Megaphone, Settings2, Sparkles, UserPlus } from "@openpromoter/ui/icons";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { searchPartnersAction } from "@/app/app/[programId]/actions";
import type { navGroups } from "./app-shell";

export function CommandPalette({
  open,
  onOpenChange,
  base,
  groups,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  base: string;
  groups: ReturnType<typeof navGroups>;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [partners, setPartners] = useState<{ id: string; name: string; email: string }[]>([]);
  const programId = base.split("/")[2]!;

  useEffect(() => {
    if (q.length < 2) return setPartners([]);
    const t = setTimeout(async () => {
      const r = await searchPartnersAction(programId, q);
      if (r.ok) setPartners(r.data ?? []);
    }, 150);
    return () => clearTimeout(t);
  }, [q, programId]);

  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };
  const item =
    "flex h-10 cursor-default items-center gap-3 rounded-lg px-2.5 text-[13px] text-fg data-[selected=true]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-subtle";
  const heading =
    "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-subtle";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-[rgb(22_23_26/0.32)] backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed top-[15vh] left-1/2 z-[70] w-[calc(100%-24px)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-lg outline-none">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search pages, partners and actions
          </DialogPrimitive.Description>
          <Command label="Command palette" className={heading}>
            <Command.Input
              value={q}
              onValueChange={setQ}
              placeholder="Search partners, pages and actions or ask a question"
              className="h-14 w-full border-b border-border bg-transparent px-5 text-[15px] text-fg outline-none placeholder:text-subtle"
            />
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-2 py-6 text-center text-[13px] text-muted">
                No matches. Press Enter to ask AI.
              </Command.Empty>
              {partners.length ? (
                <Command.Group heading="Partners">
                  {partners.map((p) => (
                    <Command.Item
                      key={p.id}
                      value={`partner ${p.name} ${p.email}`}
                      onSelect={() => go(`${base}/partners/${p.id}`)}
                      className={item}
                    >
                      <Avatar name={p.name} size={18} /> {p.name}{" "}
                      <span className="ml-auto truncate text-xs text-subtle">{p.email}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              <Command.Group heading="Actions">
                <Command.Item onSelect={() => go(`${base}/partners?invite=1`)} className={item}>
                  <UserPlus /> Invite a partner
                </Command.Item>
                <Command.Item onSelect={() => go(`${base}/campaigns?new=1`)} className={item}>
                  <Megaphone /> New campaign
                </Command.Item>
                <Command.Item onSelect={() => go(`${base}/payouts`)} className={item}>
                  <Banknote /> Prepare payouts
                </Command.Item>
              </Command.Group>
              {groups.map((g) => (
                <Command.Group key={g.label} heading={g.label}>
                  {g.items.map((i) => (
                    <Command.Item
                      key={i.href}
                      value={`go ${i.label}`}
                      onSelect={() => go(i.href)}
                      className={item}
                    >
                      <i.icon /> {i.label}
                      {i.key ? (
                        <span className="ml-auto font-mono text-[11px] text-subtle">g {i.key}</span>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              <Command.Group heading="Settings">
                {[
                  ["Program & commission", "settings"],
                  ["Branding & portal", "settings/branding"],
                  ["Install & tracking", "settings/install"],
                  ["Integrations", "settings/integrations"],
                  ["API keys & webhooks", "settings/developers"],
                  ["Team", "settings/team"],
                  ["Audit log", "settings/audit"],
                ].map(([l, p]) => (
                  <Command.Item
                    key={p}
                    value={`settings ${l}`}
                    onSelect={() => go(`${base}/${p}`)}
                    className={item}
                  >
                    <Settings2 /> {l}
                  </Command.Item>
                ))}
              </Command.Group>
              {/* last, so Enter on a page or partner name opens it; with no match this is the only item */}
              {q.length > 3 ? (
                <Command.Group heading="AI">
                  <Command.Item
                    value={`ask ${q}`}
                    onSelect={() => go(`${base}/assistant?q=${encodeURIComponent(q)}`)}
                    className={item}
                  >
                    <Sparkles /> Ask: “{q}”
                  </Command.Item>
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
