import { env } from "./env";

/**
 * Cloudflare Turnstile. On only when both keys are set, so self-hosters without keys see no captcha.
 * Sign-up, email sign-in and password reset are checked by better-auth's captcha plugin (auth.ts);
 * partner applications call verifyCaptcha themselves because they sign up through auth.api.
 */
export const captchaSiteKey =
  env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : undefined;

/**
 * Captcha only on the app's own host. Founders' custom portal domains (partners.theirapp.com) aren't in
 * the widget's hostname list, so the widget would fail there.
 * ponytail: custom-domain applications rely on the per-IP rate limit; add each domain to the widget
 * through the Turnstile API if bots show up there.
 */
export function captchaFor(h: Headers): string | undefined {
  return isAppHost(h) ? captchaSiteKey : undefined;
}

/** The Host header, not request.url: behind a proxy the URL carries the server's own address (0.0.0.0:3000). */
export const isAppHost = (h: Headers) => h.get("host") === new URL(env.APP_URL).host;

export async function verifyCaptcha(token: string | undefined, ip: string | null): Promise<boolean> {
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return ((await r.json()) as { success?: boolean }).success === true;
  } catch {
    return false;
  }
}
