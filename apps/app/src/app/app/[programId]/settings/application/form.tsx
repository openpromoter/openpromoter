"use client";

import type { ApplicationQuestion, AutoApproveRules } from "@openpromoter/db";
import { Button, Field, Input, Select, Switch } from "@openpromoter/ui";
import { Plus, Trash2 } from "@openpromoter/ui/icons";
import { useState } from "react";
import { CopyField } from "@/components/copy";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import { updateApplicationAction } from "../../settings-actions";

export function ApplicationForm({
  programId,
  canWrite,
  questions,
  autoApprove,
  applyUrl,
}: {
  programId: string;
  canWrite: boolean;
  questions: ApplicationQuestion[];
  autoApprove: AutoApproveRules;
  applyUrl: string;
}) {
  const [qs, setQs] = useState(questions);
  const [rules, setRules] = useState(autoApprove);
  const { pending, run } = useAction();
  const save = () =>
    run(() => updateApplicationAction(programId, { questions: qs, autoApprove: rules }), "Saved");
  return (
    <>
      <SettingsCard
        title="Application link"
        description="Share it anywhere. Invite-only programs reject applications without an invite."
      >
        <CopyField value={applyUrl} />
      </SettingsCard>
      <SettingsCard
        title="Auto-approve"
        description="Approve good applications instantly so partners can start the same minute."
        footer={
          canWrite ? (
            <Button variant="primary" loading={pending} onClick={save}>
              Save
            </Button>
          ) : null
        }
      >
        <label className="flex items-center justify-between gap-4">
          <span className="text-[13px] font-medium text-fg">
            Approve automatically when the rules below pass
          </span>
          <Switch
            checked={rules.enabled}
            disabled={!canWrite}
            onCheckedChange={(v) => setRules({ ...rules, enabled: v })}
            aria-label="Auto-approve"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Max risk score"
            htmlFor="aa-risk"
            hint="Disposable emails and missing websites raise the score."
          >
            <Input
              id="aa-risk"
              type="number"
              min={0}
              max={100}
              value={rules.maxRiskScore}
              disabled={!canWrite}
              onChange={(e) => setRules({ ...rules, maxRiskScore: Number(e.target.value) })}
              className="num"
            />
          </Field>
          <Field label="Require a website" htmlFor="aa-web">
            <Select
              id="aa-web"
              value={rules.requireWebsite ? "yes" : "no"}
              disabled={!canWrite}
              onValueChange={(v) => setRules({ ...rules, requireWebsite: v === "yes" })}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </Field>
          <Field label="Blocked countries" htmlFor="aa-cc" hint="Comma-separated ISO codes">
            <Input
              id="aa-cc"
              value={rules.blockedCountries.join(", ")}
              disabled={!canWrite}
              onChange={(e) =>
                setRules({
                  ...rules,
                  blockedCountries: e.target.value
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter((s) => s.length === 2),
                })
              }
            />
          </Field>
          <Field label="Only these email domains" htmlFor="aa-dom" hint="Leave empty to allow all">
            <Input
              id="aa-dom"
              value={rules.allowedEmailDomains.join(", ")}
              disabled={!canWrite}
              onChange={(e) =>
                setRules({
                  ...rules,
                  allowedEmailDomains: e.target.value
                    .split(",")
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        </div>
      </SettingsCard>
      <SettingsCard
        title="Questions"
        description="Asked on the application form after name and email."
        footer={
          canWrite ? (
            <>
              <Button
                variant="ghost"
                onClick={() =>
                  setQs([...qs, { id: `q${Date.now()}`, label: "", type: "text", required: false }])
                }
              >
                <Plus /> Add question
              </Button>
              <Button variant="primary" loading={pending} onClick={save}>
                Save
              </Button>
            </>
          ) : null
        }
      >
        {qs.length === 0 ? (
          <p className="text-[13px] text-muted">
            No extra questions. Most programs ask how the partner plans to promote.
          </p>
        ) : null}
        {qs.map((q, i) => (
          <div
            key={q.id}
            className="grid grid-cols-[1fr_auto] gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_140px_auto_auto]"
          >
            <Input
              value={q.label}
              placeholder="How will you promote us?"
              aria-label="Question"
              disabled={!canWrite}
              onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <Select
              value={q.type}
              aria-label="Answer type"
              disabled={!canWrite}
              onValueChange={(v) => setQs(qs.map((x, j) => (j === i ? { ...x, type: v as "text" } : x)))}
            >
              <option value="text">Short text</option>
              <option value="textarea">Long text</option>
              <option value="url">URL</option>
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted">
              <Switch
                checked={q.required}
                disabled={!canWrite}
                onCheckedChange={(v) => setQs(qs.map((x, j) => (j === i ? { ...x, required: v } : x)))}
                aria-label="Required"
              />{" "}
              Required
            </label>
            {canWrite ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove question"
                onClick={() => setQs(qs.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        ))}
      </SettingsCard>
    </>
  );
}
