"use client";

import { TooltipProvider } from "@openpromoter/ui";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      {children}
      <Toaster
        position="bottom-right"
        closeButton
        duration={4000}
        toastOptions={{
          className: "!bg-surface !text-fg !border-border !shadow-lg !rounded-xl !text-[13px] !font-sans",
        }}
      />
    </TooltipProvider>
  );
}
