"use client";

import {
  Checkbox as CheckboxPrimitive,
  Dialog as DialogPrimitive,
  DropdownMenu as Menu,
  Popover as PopoverPrimitive,
  Select as SelectPrimitive,
  Switch as SwitchPrimitive,
  Tooltip as TooltipPrimitive,
} from "radix-ui";
import * as React from "react";
import { buttonVariants, cn, fieldClass } from "./base";
import { Check, ChevronDown, X } from "./icons";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 dark:bg-bg dark:data-[state=checked]:bg-primary-fg" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-border-strong bg-surface data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-fg",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <svg
          viewBox="0 0 16 16"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden
        >
          {props.checked === "indeterminate" ? <path d="M4 8h8" /> : <path d="m3.5 8.5 3 3 6-7" />}
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** "right" renders a sheet. */
  side?: "right";
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(22_23_26/0.32)] backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col border border-border bg-surface shadow-lg outline-none",
          side === "right"
            ? "inset-y-2 right-2 w-[calc(100%-16px)] max-w-[480px] rounded-xl"
            : "top-[12vh] left-1/2 max-h-[80vh] w-[calc(100%-32px)] max-w-lg -translate-x-1/2 rounded-xl",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <DialogPrimitive.Title className="text-[15px] font-medium tracking-[-0.01em] text-fg">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{String(title)}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            aria-label="Close"
          >
            <X />
          </DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "-mx-5 mt-4 -mb-4 flex justify-end gap-2 border-t border-border bg-surface-2/50 px-5 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({
  children,
  align = "end",
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
}) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={4}
        className={cn("z-40 min-w-48 rounded-lg border border-border bg-surface p-1 shadow-md", className)}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export function DropdownMenuItem({
  className,
  danger,
  ...props
}: React.ComponentProps<typeof Menu.Item> & { danger?: boolean }) {
  return (
    <Menu.Item
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] text-fg outline-none select-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted",
        danger && "text-danger [&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuSeparator = () => <Menu.Separator className="my-1 h-px bg-border" />;
export const DropdownMenuLabel = ({ children }: { children: React.ReactNode }) => (
  <Menu.Label className="eyebrow px-2 py-1.5">{children}</Menu.Label>
);

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({
  children,
  className,
  align = "start",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "start" | "end" | "center";
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={4}
        className={cn(
          "z-40 rounded-lg border border-border bg-surface p-3 shadow-md outline-none",
          className,
        )}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-md bg-ink px-2 py-1 text-xs text-ink-fg shadow-md"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ Select */

type SelectProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  form?: string;
  className?: string;
  "aria-label"?: string;
  /** `<option value="..">Label</option>` elements, the same markup a native select takes. */
  children: React.ReactNode;
};

/**
 * Custom select built on Radix Select (WAI-ARIA listbox: arrows, Home/End, Enter/Space, Escape and
 * type-ahead). The trigger looks like Input and the open list looks like the app's menus. Radix keeps a
 * hidden native select with the same name, so FormData, server actions and form onChange still work.
 * Options are plain `<option>` children. With no value or defaultValue the first option is selected,
 * the same as a native select.
 */
export function Select({
  id,
  className,
  children,
  value,
  defaultValue,
  "aria-label": ariaLabel,
  ...root
}: SelectProps) {
  const options = React.Children.toArray(children).flatMap((c) => {
    if (!React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement>>(c) || c.type !== "option")
      return [];
    return [{ value: String(c.props.value ?? ""), label: c.props.children, disabled: c.props.disabled }];
  });
  const current = value ?? defaultValue ?? options[0]?.value;
  // Radix shows the placeholder for an empty value, so an option with value "" shows its label there.
  const emptyLabel = options.find((o) => o.value === "")?.label;
  return (
    <SelectPrimitive.Root {...root} value={value} defaultValue={value === undefined ? current : undefined}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          fieldClass,
          "flex h-8 cursor-pointer items-center justify-between gap-2 text-left focus-visible:outline-none disabled:cursor-default data-[placeholder]:text-fg [&>span]:truncate",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={emptyLabel} />
        <SelectPrimitive.Icon className="shrink-0 text-subtle">
          <ChevronDown className="size-3.5" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-[60] max-h-[min(320px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-16px)] overflow-hidden rounded-lg border border-border bg-surface shadow-md"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="flex min-h-8 cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-2 text-[13px] text-fg outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 data-[state=checked]:font-medium"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-auto pl-2 text-fg">
                  <Check className="size-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
