import { cva } from "class-variance-authority";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ Button */

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm text-[13px] font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:bg-primary-hover",
        accent: "bg-accent text-accent-fg hover:bg-accent-hover",
        ink: "bg-ink text-ink-fg hover:opacity-90",
        secondary:
          "border border-border-strong bg-surface text-fg hover:bg-surface-2 dark:border-border-strong",
        ghost: "text-muted hover:bg-surface-2 hover:text-fg",
        danger: "bg-danger text-white hover:opacity-90 dark:text-bg",
        link: "h-auto px-0 text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 rounded-[5px] px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3",
        lg: "h-10 px-4 text-sm",
        icon: "size-8",
        "icon-sm": "size-7 rounded-[5px]",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

/* ------------------------------------------------------------------ Form field */

/** Shared look for Input, Textarea and the Select trigger: 32px tall, 6px radius, neutral focus. */
export const fieldClass =
  "w-full rounded-sm border border-input bg-surface px-3 text-[13px] text-fg placeholder:text-subtle hover:border-border-strong focus:border-border-strong disabled:bg-surface-2 disabled:text-subtle aria-[invalid=true]:border-danger dark:bg-surface-2";
