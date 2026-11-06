"use client";

import { Button, Select } from "@openpromoter/ui";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { joinAction } from "./actions";

export function Filters({
  categories,
  category,
  type,
}: {
  categories: string[];
  category: string;
  type: string;
}) {
  const router = useRouter();
  const go = (next: { category?: string; type?: string }) => {
    const q = new URLSearchParams();
    const c = next.category ?? category;
    const t = next.type ?? type;
    if (c && c !== "all") q.set("category", c);
    if (t && t !== "all") q.set("type", t);
    router.push(q.size ? `/network?${q}` : "/network");
  };
  return (
    <div className="flex flex-wrap gap-3">
      <Select
        aria-label="Category"
        value={category || "all"}
        onValueChange={(v) => go({ category: v })}
        className="w-48"
      >
        <option value="all">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Commission type"
        value={type || "all"}
        onValueChange={(v) => go({ type: v })}
        className="w-52"
      >
        <option value="all">Any commission type</option>
        <option value="percent">Percent of each payment</option>
        <option value="fixed">Fixed amount per payment</option>
      </Select>
    </div>
  );
}

/** One-click apply with the signed-in account. */
export function JoinButton({ slug, name }: { slug: string; name: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="primary"
      size="sm"
      loading={pending}
      aria-label={`Apply to ${name}`}
      onClick={() =>
        start(async () => {
          const r = await joinAction(slug);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.data!.approved ? `You joined ${name}` : `Application sent to ${name}`);
          router.refresh();
        })
      }
    >
      Apply
    </Button>
  );
}
