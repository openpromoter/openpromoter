"use client";

import { Button, Dialog, DialogContent } from "@openpromoter/ui";
import { Check, Copy, Download, QrCode } from "@openpromoter/ui/icons";
import { useState } from "react";
import { CopyField, useCopy } from "@/components/copy";

/** QR for one link: preview, the URL to copy, and an SVG download for print. */
export function QrDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!url} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="QR code"
        description="For print, slides and video. Scans count as clicks on this link."
      >
        {url ? (
          <div className="flex flex-col items-center gap-4">
            <div className="rounded-xl border border-border bg-white p-3 ">
              <img src={`/api/qr?url=${encodeURIComponent(url)}`} alt="QR code" width={208} height={208} />
            </div>
            <div className="w-full">
              <CopyField value={url} />
            </div>
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/qr?url=${encodeURIComponent(url)}&download=1`} download="qr.svg">
                <Download /> Download SVG
              </a>
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The referral link as a ticket stub: the link printed in mono on the left, a perforated tear line
 * with punched notches, and the stub holding Copy and QR.
 */
export function LinkTicket({ url, code, note }: { url: string; code: string; note?: React.ReactNode }) {
  const { copied, copy } = useCopy();
  const [qr, setQr] = useState<string | null>(null);
  return (
    <>
      <div className="relative flex flex-col overflow-hidden rounded-xl bg-canvas sm:flex-row dark:bg-surface-2">
        <div className="min-w-0 flex-1 px-5 pt-4 pb-5 sm:px-6 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <span className="eyebrow">Your referral link</span>
            <span className="eyebrow">No. {code}</span>
          </div>
          <span className="mt-3 block truncate font-mono text-[15px] leading-6 text-fg sm:text-[17px]">
            {url}
          </span>
          {note ? <p className="mt-1.5 truncate text-xs leading-4 text-subtle">{note}</p> : null}
        </div>
        <div aria-hidden className="relative h-0 shrink-0 sm:h-auto sm:w-0">
          <span className="absolute inset-x-5 top-0 border-t border-dashed border-border-strong sm:inset-x-auto sm:inset-y-3 sm:left-0 sm:border-t-0 sm:border-l" />
          <span className="absolute top-0 -left-2.5 size-5 -translate-y-1/2 rounded-full bg-surface sm:-top-2.5 sm:left-0 sm:-translate-x-1/2 sm:translate-y-0" />
          <span className="absolute top-0 -right-2.5 size-5 -translate-y-1/2 rounded-full bg-surface sm:top-auto sm:right-auto sm:-bottom-2.5 sm:left-0 sm:-translate-x-1/2 sm:translate-y-0" />
        </div>
        <div className="flex gap-2 px-5 pt-4 pb-4 sm:w-[176px] sm:flex-col sm:justify-center sm:px-5 sm:py-5">
          <Button variant="primary" className="flex-1 sm:flex-none" onClick={() => copy(url, "Link copied")}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setQr(url)}>
            <QrCode /> QR code
          </Button>
        </div>
      </div>
      <QrDialog url={qr} onClose={() => setQr(null)} />
    </>
  );
}
