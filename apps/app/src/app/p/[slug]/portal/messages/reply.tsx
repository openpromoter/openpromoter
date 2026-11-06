"use client";

import { Button } from "@openpromoter/ui";
import { Send } from "@openpromoter/ui/icons";
import { useRef } from "react";
import { useAction } from "@/components/use-action";
import { partnerReplyAction } from "../../portal-actions";

export function Reply({ slug }: { slug: string }) {
  const { pending, run } = useAction();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="rounded-lg border border-border-strong bg-surface focus-within:border-fg/40 dark:bg-surface-2"
      action={(f) =>
        run(
          () => partnerReplyAction(slug, String(f.get("body"))),
          "Sent",
          () => form.current?.reset(),
        )
      }
    >
      <textarea
        name="body"
        placeholder="Message the team"
        aria-label="Message"
        required
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.current?.requestSubmit();
        }}
        className="block w-full resize-none bg-transparent px-3.5 pt-3 text-[14px] leading-6 text-fg placeholder:text-subtle focus:outline-none"
      />
      <div className="flex items-center justify-between px-3 pb-2.5">
        <span className="hidden text-xs text-subtle sm:inline">⌘ Enter to send</span>
        <Button type="submit" variant="primary" size="sm" loading={pending} className="ml-auto">
          <Send /> Send
        </Button>
      </div>
    </form>
  );
}
