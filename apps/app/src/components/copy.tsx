"use client";

import { Button, cn, Tooltip } from "@openpromoter/ui";
import { Check, Copy } from "@openpromoter/ui/icons";
import { useState } from "react";
import { toast } from "sonner";

export function useCopy() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async (text: string, label = "Copied") => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(label);
      setTimeout(() => setCopied(false), 1500);
    },
  };
}

export function CopyButton({
  value,
  label = "Copy",
  className,
  size = "icon-sm",
}: {
  value: string;
  label?: string;
  className?: string;
  size?: "icon-sm" | "sm" | "md";
}) {
  const { copied, copy } = useCopy();
  const icon = copied ? <Check className="text-success" /> : <Copy />;
  return size === "icon-sm" ? (
    <Tooltip content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        className={className}
        onClick={() => copy(value)}
      >
        {icon}
      </Button>
    </Tooltip>
  ) : (
    <Button type="button" variant="secondary" size={size} className={className} onClick={() => copy(value)}>
      {icon}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function CodeBlock({ code, className, label }: { code: string; className?: string; label?: string }) {
  return (
    <div className={cn("group relative rounded-md border border-border bg-surface-2", className)}>
      {label ? (
        <div className="border-b border-border px-3 py-1.5 text-xs font-medium text-muted">{label}</div>
      ) : null}
      <pre className="overflow-x-auto px-3 py-3 pr-12 font-mono text-[12.5px] leading-5 whitespace-pre text-fg">
        {code}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={code} label="Copy code" />
      </div>
    </div>
  );
}

export function CopyField({ value, mono = true }: { value: string; mono?: boolean }) {
  return (
    <div className="flex h-8 min-w-0 items-center rounded-sm border border-border bg-surface-2 pl-2.5">
      <span className={cn("min-w-0 flex-1 truncate text-[13px] text-fg", mono && "font-mono text-[12.5px]")}>
        {value}
      </span>
      <CopyButton value={value} />
    </div>
  );
}
