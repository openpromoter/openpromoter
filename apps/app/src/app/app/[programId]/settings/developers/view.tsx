"use client";

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  Field,
  Input,
  Select,
  StatusBadge,
} from "@openpromoter/ui";
import { KeyRound, Plus, RotateCcw, Send, Trash2, Webhook } from "@openpromoter/ui/icons";
import { useState } from "react";
import { CodeBlock, CopyField } from "@/components/copy";
import { useAction } from "@/components/use-action";
import { API_SCOPES, SCOPE_LABELS } from "@/lib/scopes";
import {
  createApiKeyAction,
  createEndpointAction,
  deleteEndpointAction,
  resendDeliveryAction,
  revokeApiKeyAction,
  testEndpointAction,
} from "../../settings-actions";

type K = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
};
type E = { id: string; url: string; kind: string; events: string[]; secret: string };
type D = {
  id: string;
  endpointId: string;
  event: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
};

export function DevelopersView({
  programId,
  appUrl,
  keyPrefix,
  canWrite,
  events,
  keys,
  endpoints,
  deliveries,
}: {
  programId: string;
  appUrl: string;
  /** op_live_ on Cloud, op_sk_ self-hosted: what new keys start with */
  keyPrefix: string;
  canWrite: boolean;
  events: string[];
  keys: K[];
  endpoints: E[];
  deliveries: D[];
}) {
  const { pending, run } = useAction();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [epOpen, setEpOpen] = useState(false);
  const [scopes, setScopes] = useState<Set<string>>(new Set(["read"]));
  const [evs, setEvs] = useState<Set<string>>(new Set(["*"]));
  return (
    <>
      <Card>
        <CardHeader
          title="API keys"
          description="For the REST API, SDK, CLI and MCP server. Keys can never approve payouts."
          action={
            canWrite ? (
              <Dialog
                open={keyOpen}
                onOpenChange={(o) => {
                  setKeyOpen(o);
                  if (!o) setNewKey(null);
                }}
              >
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus /> New key
                  </Button>
                </DialogTrigger>
                <DialogContent
                  title={newKey ? "Copy your key" : "Create an API key"}
                  description={newKey ? "This is the only time it's shown." : undefined}
                >
                  {newKey ? (
                    <CopyField value={newKey} />
                  ) : (
                    <form
                      className="flex flex-col gap-4"
                      action={(f) =>
                        run(
                          () =>
                            createApiKeyAction(programId, {
                              name: String(f.get("name")),
                              scopes: [...scopes],
                            }),
                          undefined,
                          (d) => setNewKey((d as { key: string }).key),
                        )
                      }
                    >
                      <Field label="Name" htmlFor="k-name">
                        <Input id="k-name" name="name" placeholder="Production server" required />
                      </Field>
                      <fieldset className="flex flex-col gap-2">
                        <legend className="mb-1 text-[13px] font-medium text-fg">Scopes</legend>
                        {API_SCOPES.map((s) => (
                          <label key={s} className="flex items-center gap-2 text-[13px]">
                            <Checkbox
                              checked={scopes.has(s)}
                              onCheckedChange={() =>
                                setScopes((x) => {
                                  const n = new Set(x);
                                  n.has(s) ? n.delete(s) : n.add(s);
                                  return n;
                                })
                              }
                            />
                            <span className="font-mono text-xs">{s}</span>{" "}
                            <span className="text-muted">{SCOPE_LABELS[s]}</span>
                          </label>
                        ))}
                      </fieldset>
                      <DialogFooter>
                        <Button type="submit" variant="primary" loading={pending}>
                          Create key
                        </Button>
                      </DialogFooter>
                    </form>
                  )}
                </DialogContent>
              </Dialog>
            ) : null
          }
        />
        {keys.length ? (
          <ul className="divide-y divide-border border-t border-border">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
                <KeyRound className="size-4 text-muted" />
                <span className="font-medium text-fg">{k.name}</span>
                <span className="font-mono text-xs text-subtle">{k.prefix}…</span>
                <span className="flex flex-wrap gap-1">
                  {k.scopes.map((s) => (
                    <Badge key={s} tone="neutral">
                      {s}
                    </Badge>
                  ))}
                </span>
                <span className="ml-auto text-xs text-subtle">
                  {k.lastUsedAt
                    ? `used ${new Date(k.lastUsedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}`
                    : "never used"}
                </span>
                {canWrite ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() =>
                      window.confirm("Revoke this key?") && run(() => revokeApiKeyAction(programId, k.id))
                    }
                  >
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-border px-5 py-6 text-[13px] text-muted">No keys yet.</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Webhooks and alerts"
          description="Signed with HMAC-SHA256 (OpenPromoter-Signature: t=…,v1=…) and retried with backoff for about a day. Slack and Discord get readable messages."
          action={
            canWrite ? (
              <Dialog open={epOpen} onOpenChange={setEpOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus /> Add endpoint
                  </Button>
                </DialogTrigger>
                <DialogContent title="Add an endpoint">
                  <form
                    className="flex flex-col gap-4"
                    action={(f) =>
                      run(
                        () =>
                          createEndpointAction(programId, {
                            url: String(f.get("url")),
                            kind: String(f.get("kind")) as "webhook",
                            events: [...evs],
                          }),
                        "Endpoint added",
                        () => setEpOpen(false),
                      )
                    }
                  >
                    <Field label="Type" htmlFor="ep-kind">
                      <Select id="ep-kind" name="kind">
                        <option value="webhook">Webhook (JSON, signed) · Zapier, Make, your server</option>
                        <option value="slack">Slack incoming webhook</option>
                        <option value="discord">Discord webhook</option>
                      </Select>
                    </Field>
                    <Field label="URL" htmlFor="ep-url">
                      <Input id="ep-url" name="url" type="url" required />
                    </Field>
                    <fieldset className="grid grid-cols-2 gap-2">
                      <legend className="mb-1 text-[13px] font-medium text-fg">Events</legend>
                      {["*", ...events].map((e) => (
                        <label key={e} className="flex items-center gap-2 font-mono text-xs">
                          <Checkbox
                            checked={evs.has(e)}
                            onCheckedChange={() =>
                              setEvs((x) => {
                                const n = new Set(x);
                                n.has(e) ? n.delete(e) : n.add(e);
                                return n;
                              })
                            }
                          />{" "}
                          {e === "*" ? "all events" : e}
                        </label>
                      ))}
                    </fieldset>
                    <DialogFooter>
                      <Button type="submit" variant="primary" loading={pending}>
                        Add
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            ) : null
          }
        />
        {endpoints.length ? (
          <ul className="divide-y divide-border border-t border-border">
            {endpoints.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Webhook className="size-4 text-muted" />
                  <Badge tone="neutral">{e.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{e.url}</span>
                  {canWrite ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => run(() => testEndpointAction(programId, e.id))}
                      >
                        <Send /> Test
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete endpoint"
                        onClick={() => run(() => deleteEndpointAction(programId, e.id))}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </div>
                {e.kind === "webhook" && canWrite ? (
                  <div className="max-w-md">
                    <CopyField value={e.secret} />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {e.events.map((x) => (
                    <span key={x} className="rounded-xs bg-surface-2 px-1.5 font-mono text-[11px] text-muted">
                      {x}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-border px-5 py-6 text-[13px] text-muted">No endpoints yet.</p>
        )}
        {deliveries.length ? (
          <div className="border-t border-border">
            <div className="px-5 pt-3 text-xs font-medium text-subtle">Recent deliveries</div>
            <ul className="divide-y divide-border">
              {deliveries.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-2 text-[13px]">
                  <StatusBadge status={d.status} />
                  <span className="font-mono text-xs text-fg">{d.event}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-subtle">
                    {d.responseStatus ? `HTTP ${d.responseStatus}` : (d.lastError ?? "")} · {d.attempts}{" "}
                    attempt{d.attempts === 1 ? "" : "s"}
                  </span>
                  <time className="text-xs text-subtle">
                    {new Date(d.createdAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                  {canWrite && d.status !== "pending" ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Resend"
                      onClick={() => run(() => resendDeliveryAction(programId, d.id))}
                    >
                      <RotateCcw />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="REST API, MCP and CLI" />
        <CardBody className="flex flex-col gap-3">
          <Field label="API base URL" htmlFor="api-base">
            <CopyField value={`${appUrl}/api/v1`} />
          </Field>
          <p className="text-[13px] text-muted">
            OpenAPI spec:{" "}
            <a className="text-accent-text hover:underline" href="/api/openapi.json">
              {appUrl}/api/openapi.json
            </a>{" "}
            · Program id: <span className="font-mono placeholder:font-sans">{programId}</span>
          </p>
          <CodeBlock
            label="MCP server (any MCP client: Claude, Cursor, VS Code, Windsurf and more)"
            code={JSON.stringify(
              {
                mcpServers: {
                  openpromoter: {
                    command: "npx",
                    args: ["-y", "openpromoter-mcp"],
                    env: { OPENPROMOTER_API_KEY: `${keyPrefix}...`, OPENPROMOTER_URL: appUrl },
                  },
                },
              },
              null,
              2,
            )}
          />
          <CodeBlock
            label="CLI"
            code={`npx openpromoter-cli login --url ${appUrl} --key ${keyPrefix}...\nnpx openpromoter-cli partners list --program ${programId}`}
          />
        </CardBody>
      </Card>
    </>
  );
}
