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
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from "@openpromoter/ui";
import {
  Download,
  ExternalLink,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "@openpromoter/ui/icons";
import { useState } from "react";
import { CopyButton } from "@/components/copy";
import { useAction } from "@/components/use-action";
import {
  addResourceAction,
  deleteAssetAction,
  deleteResourceAction,
  regenerateContentAction,
  saveAssetAction,
} from "../growth-actions";

type A = {
  id: string;
  kind: string;
  title: string;
  body: string;
  meta: Record<string, unknown> | null;
  by: string;
};
const KINDS = [
  ["swipe", "Swipe copy"],
  ["social", "Social posts"],
  ["email", "Emails"],
  ["comparison", "Comparison blurbs"],
  ["banner", "Banners"],
] as const;

export function ContentView({
  programId,
  canWrite,
  ai,
  assets,
  resources,
}: {
  programId: string;
  canWrite: boolean;
  ai: boolean;
  assets: A[];
  resources: {
    id: string;
    title: string;
    url: string;
    description: string | null;
    fileName: string | null;
  }[];
}) {
  const { pending, run } = useAction();
  const [edit, setEdit] = useState<Partial<A> | null>(null);
  return (
    <div className="flex flex-col gap-6">
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button loading={pending} onClick={() => run(() => regenerateContentAction(programId))}>
            <RefreshCw /> Regenerate from my site
          </Button>
          <Button onClick={() => setEdit({ kind: "swipe", title: "", body: "" })}>
            <Plus /> Add your own
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-subtle sm:ml-auto">
            <Sparkles className="size-3.5" aria-hidden />
            {ai
              ? "Written by AI from your site"
              : "Templates for now. Add an AI key for copy written from your site."}
          </span>
        </div>
      ) : null}
      {assets.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            mascot="thinking"
            title="Your content kit is being written"
            description="It's generated from your website a few seconds after setup. Refresh in a moment or regenerate it now."
          />
        </Card>
      ) : null}
      {KINDS.map(([k, label]) => {
        const items = assets.filter((a) => a.kind === k);
        if (!items.length) return null;
        return (
          <section key={k}>
            <h2 className="mb-2 text-[15px] font-medium text-fg">{label}</h2>
            <div
              className={`grid gap-3 ${k === "banner" ? "sm:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-2"}`}
            >
              {items.map((a) =>
                k === "banner" ? (
                  <Card key={a.id} className="overflow-hidden">
                    <div className="flex h-40 items-center justify-center bg-surface-2 p-3">
                      <img
                        src={`/api/banner/${a.id}`}
                        alt={a.title}
                        className="max-h-full max-w-full rounded-xs "
                      />
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 text-[13px]">
                      <span className="text-fg">{a.title}</span>
                      <a
                        href={`/api/banner/${a.id}?download=1`}
                        className="-my-2 inline-flex shrink-0 items-center gap-1 py-2 text-xs font-medium text-accent-text hover:underline"
                      >
                        <Download className="size-3.5" /> Download
                      </a>
                    </div>
                  </Card>
                ) : (
                  <Card key={a.id}>
                    <CardHeader
                      title={a.title}
                      action={
                        <span className="flex">
                          <CopyButton value={a.body} label="Copy" />
                          {canWrite ? (
                            <>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Edit"
                                onClick={() => setEdit(a)}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Delete"
                                onClick={() => run(() => deleteAssetAction(programId, a.id))}
                              >
                                <Trash2 />
                              </Button>
                            </>
                          ) : null}
                        </span>
                      }
                    />
                    <CardBody>
                      <p className="text-[13px] leading-6 whitespace-pre-wrap text-fg/90">{a.body}</p>
                    </CardBody>
                  </Card>
                ),
              )}
            </div>
          </section>
        );
      })}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[15px] font-medium text-fg">Resources library</h2>
          {canWrite ? <AddResource programId={programId} /> : null}
        </div>
        <Card>
          {resources.length ? (
            <ul className="divide-y divide-border">
              {resources.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex min-w-0 flex-1 items-center gap-2 text-fg hover:underline"
                  >
                    {r.fileName ? (
                      <Download className="size-3.5 text-muted" />
                    ) : (
                      <ExternalLink className="size-3.5 text-muted" />
                    )}{" "}
                    <span className="truncate">{r.title}</span>
                  </a>
                  <span className="hidden truncate text-xs text-subtle md:inline">{r.description}</span>
                  {canWrite ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Remove"
                      onClick={() => run(() => deleteResourceAction(programId, r.id), "Removed")}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[13px] text-muted">
              Upload your own banners, logos, screenshots or a press kit. Or add a link, such as a Loom
              walkthrough.
            </p>
          )}
        </Card>
      </section>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit ? (
          <DialogContent
            title={edit.id ? "Edit content" : "Add content"}
            description="Use {{link}} where the partner's link should go."
          >
            <form
              className="flex flex-col gap-4"
              action={(f) =>
                run(
                  () =>
                    saveAssetAction(programId, {
                      id: edit.id,
                      kind: String(f.get("kind")) as "swipe",
                      title: String(f.get("title")),
                      body: String(f.get("body")),
                    }),
                  "Saved",
                  () => setEdit(null),
                )
              }
            >
              <Field label="Type" htmlFor="ca-kind">
                <Select id="ca-kind" name="kind" defaultValue={edit.kind}>
                  {KINDS.filter(([k]) => k !== "banner").map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title" htmlFor="ca-title">
                <Input id="ca-title" name="title" defaultValue={edit.title} required />
              </Field>
              <Field label="Text" htmlFor="ca-body">
                <Textarea id="ca-body" name="body" defaultValue={edit.body} className="h-48" required />
              </Field>
              <DialogFooter>
                <Button type="submit" variant="primary" loading={pending}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function AddResource({ programId }: { programId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add resource
        </Button>
      </DialogTrigger>
      <DialogContent title="Add a resource">
        <form
          className="flex flex-col gap-4"
          // onSubmit, not action: a form action clears every field afterwards, even after a validation error
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const file = f.get("file");
            const upload = file instanceof File && file.size > 0 ? file : null;
            const url = String(f.get("url") || "");
            if (!upload && !url) return setError("Choose a file or paste a link.");
            if (upload && upload.size > 10 * 1024 * 1024) return setError("Files can be up to 10 MB.");
            setError(null);
            return run(
              () =>
                addResourceAction(programId, {
                  title: String(f.get("title")),
                  url: upload ? undefined : url,
                  file: upload,
                  description: String(f.get("description") || "") || undefined,
                }),
              "Added",
              () => setOpen(false),
            );
          }}
        >
          <Field label="Title" htmlFor="rs-title">
            <Input id="rs-title" name="title" required />
          </Field>
          <Field
            label="Upload a file"
            htmlFor="rs-file"
            hint="An image, PDF, MP4 or WebM video, or a ZIP. Up to 10 MB."
            error={error}
          >
            <Input
              id="rs-file"
              name="file"
              type="file"
              className="h-auto py-1.5 file:mr-3 file:border-0 file:bg-transparent file:font-medium file:text-fg"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,video/mp4,video/webm,application/zip"
            />
          </Field>
          <Field label="Or paste a link" htmlFor="rs-url">
            <Input id="rs-url" name="url" type="url" placeholder="https://" />
          </Field>
          <Field label="Description" htmlFor="rs-desc">
            <Input id="rs-desc" name="description" />
          </Field>
          <DialogFooter>
            <Button type="submit" variant="primary" loading={pending}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
