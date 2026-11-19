export const LOGO_MAX_BYTES = 1024 * 1024;

const startsWith = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((x, i) => b[at + i] === x);

/**
 * Checks an uploaded logo by its first bytes, never by the name or type the browser sent. Only PNG, JPEG and
 * WebP: SVG can carry script, and Gmail and Outlook don't show it in emails.
 */
export function readLogo(
  b: Uint8Array,
): { type: "image/png" | "image/jpeg" | "image/webp" } | { error: string } {
  if (b.length > LOGO_MAX_BYTES) return { error: "Logos can be up to 1 MB" };
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: "image/png" };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { type: "image/jpeg" };
  // RIFF....WEBP
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return { type: "image/webp" };
  return { error: "Upload a PNG, JPG or WebP logo" };
}
