"use client";

import { Badge, Button, Kbd } from "@openpromoter/ui";
import {
  ArrowUp,
  ArrowUpRight,
  Banknote,
  ChartColumn,
  Loader2,
  ShieldAlert,
  Sparkles,
  Trophy,
  Users,
  Webhook,
} from "@openpromoter/ui/icons";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { LogoMark } from "@/components/logo";
import type { Answer } from "@/server/ai/assistant";
import { askAction } from "../growth-actions";

const SUGGESTED = [
  { q: "Which partners brought paying customers last month?", icon: Users },
  { q: "How much do we owe partners right now?", icon: Banknote },
  { q: "Who are my top partners this quarter?", icon: Trophy },
  { q: "Any suspicious activity this week?", icon: ShieldAlert },
  { q: "Which traffic sources convert best?", icon: ChartColumn },
  { q: "Which partners have gone quiet?", icon: Webhook },
];

function hello() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Agent-style screen: centred greeting with prompt chips, a running thread, and a composer pinned at the bottom. */
export function AssistantView({
  programId,
  initial,
  ai,
  programName,
  firstName,
}: {
  programId: string;
  initial: string;
  ai: boolean;
  programName: string;
  firstName: string;
}) {
  const [q, setQ] = useState(initial);
  const [log, setLog] = useState<{ q: string; a: Answer | null }[]>([]);
  const [pending, start] = useTransition();
  const ran = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const send = (question: string) => {
    setLog((l) => [...l, { q: question, a: null }]);
    setQ("");
    start(async () => {
      const r = await askAction(programId, question);
      if (!r.ok) {
        setLog((l) => l.slice(0, -1));
        return void toast.error(r.error);
      }
      setLog((l) => [...l.slice(0, -1), { q: question, a: r.data! }]);
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: run the ?q= question once on mount
  useEffect(() => {
    if (initial && !ran.current) {
      ran.current = true;
      send(initial);
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the log grows
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log]);

  const submit = () => q.trim() && !pending && send(q.trim());

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-56px-60px)] flex-col md:-mx-8 md:-my-8 md:h-[calc(100dvh-56px-18px)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-8">
        {log.length === 0 ? (
          <div className="mx-auto flex h-full max-w-[712px] flex-col justify-center py-10">
            <LogoMark size={22} />
            <h2 className="mt-4 text-[22px] leading-7 font-medium tracking-[-0.02em] text-fg">
              {hello()}
              {firstName ? `, ${firstName}` : ""}
            </h2>
            <p className="mt-1 text-[14px] text-muted">
              Ask anything about the {programName} partner program.
            </p>
            <h3 className="mt-8 mb-2 text-xs font-medium text-subtle">Try one of these</h3>
            <ul className="grid overflow-hidden rounded-lg border border-border sm:grid-cols-2">
              {SUGGESTED.map((s) => (
                <li
                  key={s.q}
                  className="border-border not-last:border-b sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => send(s.q)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-[13px] text-fg hover:bg-surface-2"
                  >
                    <s.icon className="size-4 shrink-0 text-subtle" />
                    <span className="min-w-0 flex-1">{s.q}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-subtle" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="mx-auto flex max-w-[712px] flex-col gap-6 py-8">
            {log.map((x, i) => (
              <li key={i} className="flex flex-col gap-4">
                <p className="ml-auto max-w-[80%] rounded-lg bg-accent-soft px-3.5 py-2 text-[14px] leading-6 whitespace-pre-wrap text-fg">
                  {x.q}
                </p>
                <div className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-fg">
                    <LogoMark size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    {x.a ? (
                      <>
                        <p className="text-[14px] leading-6 whitespace-pre-line text-fg">{x.a.text}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {x.a.links.map((l) => (
                            <Button key={l.href + l.label} asChild size="sm">
                              <Link href={l.href}>
                                {l.label} <ArrowUpRight className="text-subtle" />
                              </Link>
                            </Button>
                          ))}
                          <Badge tone="neutral" className="ml-auto font-mono text-[11px] font-normal">
                            {x.a.source === "ai" ? "ai" : "report"} · {x.a.tool.replace(/_/g, " ")}
                          </Badge>
                        </div>
                      </>
                    ) : (
                      <p className="flex h-7 items-center gap-2 text-[13px] text-muted">
                        <Loader2 className="size-4" /> Reading your ledger…
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
            <div ref={end} />
          </ol>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="shrink-0 px-4 pb-4 md:px-8 md:pb-6"
      >
        <div className="mx-auto max-w-[712px] rounded-lg border border-border-strong bg-surface focus-within:border-fg/40 dark:bg-surface-2">
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about partners, payouts, fraud or revenue"
            aria-label="Question"
            rows={2}
            className="block max-h-56 min-h-14 w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-6 text-fg [field-sizing:content] placeholder:text-subtle"
            // biome-ignore lint/a11y/noAutofocus: this page exists to take a question, as it did before
            autoFocus
          />
          <div className="flex items-center gap-3 px-2.5 pt-1 pb-2.5 pl-3.5">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-subtle">
              <Sparkles className="size-3.5 shrink-0" />
              {ai ? "Answers come from your own data" : "Rules mode: matched to the closest report"}
            </span>
            <span className="ml-auto hidden items-center gap-1 text-xs text-subtle md:flex">
              <Kbd>↵</Kbd>
            </span>
            <Button type="submit" variant="primary" size="sm" loading={pending} className="ml-auto md:ml-0">
              {pending ? null : <ArrowUp />} Ask
            </Button>
          </div>
        </div>
        {!ai ? (
          <p className="mx-auto mt-2 max-w-[712px] text-xs text-subtle">
            Add ANTHROPIC_API_KEY (or an OpenAI-compatible endpoint) for free-form answers.
          </p>
        ) : null}
      </form>
    </div>
  );
}
