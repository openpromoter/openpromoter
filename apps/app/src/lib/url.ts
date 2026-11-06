/**
 * A same-site path to go to after sign-in, or the fallback. `//evil.com` and `/\evil.com` are rejected:
 * browsers read both as another host.
 */
export const safeNext = (next: string | undefined, fallback: string) =>
  next && /^\/(?![/\\])/.test(next) && !/[\r\n\t]/.test(next) ? next : fallback;

/** zod-ready check: only http(s) URLs, never javascript:, data: or ftp:. */
export const HTTP_URL = { protocol: /^https?$/ } as const;
