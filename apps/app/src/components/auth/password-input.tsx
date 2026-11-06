"use client";

import { Input } from "@openpromoter/ui";
import { useState } from "react";

/** Password field with a Show button, so people can check what they typed before submitting. */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement> & { id: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className="h-10 pr-16" />
      <button
        type="button"
        aria-controls={props.id}
        aria-pressed={shown}
        aria-label={shown ? "Hide password" : "Show password"}
        onClick={() => setShown((v) => !v)}
        className="absolute inset-y-1 right-1 rounded-[5px] px-2.5 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-fg"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
