"use client";

import { useEffect, useRef, useState } from "react";

type Turnstile = {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<void> | null = null;
function load() {
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject();
    };
    document.head.appendChild(s);
  });
  return loading;
}

let widget: string | undefined;

/**
 * Cloudflare Turnstile. Renders nothing without a site key. Most visitors never see it; a checkbox shows
 * only when Cloudflare is unsure. It puts its token in a hidden `cf-turnstile-response` field of the form.
 */
export function Captcha({ siteKey }: { siteKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // visible only while Cloudflare asks for a click; until then the slot takes no room in the form
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!siteKey) return;
    let gone = false;
    load()
      .then(() => {
        if (gone || !ref.current || !window.turnstile) return;
        widget = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          size: "flexible",
          theme: "auto",
          "before-interactive-callback": () => setShown(true),
          "after-interactive-callback": () => setShown(false),
        });
      })
      .catch(() => {});
    return () => {
      gone = true;
      if (widget) window.turnstile?.remove(widget);
      widget = undefined;
    };
  }, [siteKey]);
  // -mt-5 cancels the forms' gap-5 while the slot is empty
  return siteKey ? <div ref={ref} className={shown ? undefined : "-mt-5 h-0 overflow-hidden"} /> : null;
}

/** The form's token. Waits up to 8s: it arrives a moment after the page loads. */
export async function captchaToken(form: HTMLFormElement, siteKey?: string) {
  if (!siteKey) return undefined;
  for (let i = 0; i < 40; i++) {
    const v = (form.elements.namedItem("cf-turnstile-response") as HTMLInputElement | null)?.value;
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

/** The token as the request header better-auth's captcha plugin reads. */
export async function captchaHeaders(form: HTMLFormElement, siteKey?: string) {
  const v = await captchaToken(form, siteKey);
  return v ? { headers: { "x-captcha-response": v } } : {};
}

/** A token works once. After any submit the widget fetches a new one. */
export function resetCaptcha() {
  if (widget) window.turnstile?.reset(widget);
}

export const CAPTCHA_ERROR = "Please complete the check above the button, then try again.";
export const isCaptchaError = (code?: string) =>
  !!code && /CAPTCHA|VERIFICATION_FAILED|MISSING_RESPONSE/i.test(code);
