"use client";

import { Badge, Button, Card, CardBody, CardHeader, EmptyState, StatusBadge, Switch } from "@openpromoter/ui";
import { Bot, Check, Play, Sparkles, Undo2, X } from "@openpromoter/ui/icons";
import { useEffect, useState } from "react";
import { useAction } from "@/components/use-action";
import { agentAction_, autopilotSettingsAction, runAutopilotAction } from "../growth-actions";

type A = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  status: string;
  source: string;
  createdAt: string;
  appliedAt: string | null;
  payload: Record<string, unknown>;
};

export function AutopilotView({
  programId,
  canWrite,
  enabled: savedEnabled,
  mode: savedMode,
  ai,
  actions,
}: {
  programId: string;
  canWrite: boolean;
  enabled: boolean;
  mode: "suggest" | "act";
  ai: boolean;
  actions: A[];
}) {
  const { pending, run } = useAction();
  // local state: a mode picked right after switching on must send "on", not the last server value
  const [enabled, setEnabled] = useState(savedEnabled);
  const [mode, setMode] = useState(savedMode);
  useEffect(() => setEnabled(savedEnabled), [savedEnabled]);
  useEffect(() => setMode(savedMode), [savedMode]);
  const save = (next: { enabled: boolean; mode: "suggest" | "act" }) => {
    setEnabled(next.enabled);
    setMode(next.mode);
    run(() => autopilotSettingsAction(programId, next));
  };
  const open = actions.filter((a) => a.status === "suggested");
  const log = actions.filter((a) => a.status !== "suggested");
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <CardHeader
            title="Suggestions"
            description={open.length ? `${open.length} waiting for you` : "You're all caught up"}
            action={
              canWrite ? (
                <Button
                  size="sm"
                  loading={pending}
                  onClick={() =>
                    run(
                      () => runAutopilotAction(programId),
                      (d) => `Autopilot ran: ${(d as { created: number })?.created ?? 0} new suggestions`,
                    )
                  }
                >
                  <Play /> Run now
                </Button>
              ) : null
            }
          />
          {open.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {open.map((a) => (
                <li key={a.id} id={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
                  <Bot className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-fg">{a.title}</div>
                    <p className="mt-0.5 text-[13px] text-muted">{a.detail}</p>
                    {typeof a.payload.body === "string" ? (
                      <blockquote className="mt-2 rounded-sm border-l-2 border-border-strong bg-surface-2 px-3 py-2 text-[13px] whitespace-pre-line text-fg/90">
                        {a.payload.body}
                      </blockquote>
                    ) : null}
                    {a.kind === "prepare_payouts" ? (
                      <p className="mt-2 text-xs text-warning">
                        Prepares the batch only. You still approve it on the Payouts page.
                      </p>
                    ) : null}
                  </div>
                  {canWrite ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        loading={pending}
                        onClick={() => run(() => agentAction_(programId, a.id, "apply"))}
                      >
                        <Check /> Do it
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Dismiss"
                        onClick={() => run(() => agentAction_(programId, a.id, "dismiss"))}
                      >
                        <X />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Sparkles}
              mascot="resting"
              title="No suggestions right now"
              description="Autopilot checks for idle partners, top performers, risky accounts, slowing growth, waiting applications and due payouts every week."
            />
          )}
        </Card>
        <Card>
          <CardHeader
            title="Activity log"
            description="What Autopilot and the other AI features did and when"
          />
          {log.length ? (
            <ul className="divide-y divide-border border-t border-border">
              {log.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                  <StatusBadge status={a.status} />
                  <span className="min-w-0 flex-1 truncate text-fg">{a.title}</span>
                  <time className="hidden text-xs text-subtle sm:inline">
                    {new Date(a.appliedAt ?? a.createdAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                  {a.status === "applied" && canWrite ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => run(() => agentAction_(programId, a.id, "undo"))}
                    >
                      <Undo2 /> Undo
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-border px-5 py-6 text-[13px] text-muted">Nothing yet.</p>
          )}
        </Card>
      </div>
      <Card className="h-fit">
        <CardHeader title="Settings" />
        <CardBody className="flex flex-col gap-5">
          <label className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-[13px] font-medium text-fg">Weekly Autopilot</span>
              <span className="block text-xs text-muted">Reviews the program once a week.</span>
            </span>
            <Switch
              checked={enabled}
              disabled={!canWrite}
              onCheckedChange={(v) => save({ enabled: v, mode })}
              aria-label="Weekly Autopilot"
            />
          </label>
          <fieldset disabled={!canWrite} className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-medium text-fg">When it finds something</legend>
            {(
              [
                ["suggest", "Suggest changes for me to approve", "Nothing changes until you click."],
                [
                  "act",
                  "Act and tell me after",
                  "Applies safe actions (messages, tier moves, pausing risky partners, approving clean applications). Undo any of them.",
                ],
              ] as const
            ).map(([v, l, d]) => (
              <label
                key={v}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${mode === v ? "border-accent bg-accent-soft/40" : "border-border"}`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={v}
                  checked={mode === v}
                  onChange={() => save({ enabled, mode: v })}
                  className="mt-[3px] size-3.5 shrink-0 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-[13px] font-medium text-fg">{l}</span>
                  <span className="block text-xs text-muted">{d}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="rounded-sm bg-surface-2 p-3 text-xs text-muted">
            <Badge tone={ai ? "primary" : "neutral"} icon={Sparkles} className="mb-1.5">
              {ai ? "AI on" : "Rules only"}
            </Badge>
            <p>
              {ai
                ? "Messages and summaries are written by your AI provider."
                : "Add ANTHROPIC_API_KEY (or an OpenAI-compatible endpoint) for AI-written messages. Everything else works without it."}
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
