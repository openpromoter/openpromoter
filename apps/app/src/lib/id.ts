import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function randomString(length: number, alphabet = ALPHABET): string {
  const bytes = randomBytes(length * 2);
  let out = "";
  // ponytail: rejection sampling keeps the distribution uniform
  for (let i = 0; i < bytes.length && out.length < length; i++) {
    const b = bytes[i]!;
    if (b < 256 - (256 % alphabet.length)) out += alphabet[b % alphabet.length];
  }
  return out.length === length ? out : randomString(length, alphabet);
}

export type IdPrefix =
  | "ws"
  | "eml"
  | "prg"
  | "grp"
  | "prt"
  | "lnk"
  | "prm"
  | "clk"
  | "ref"
  | "com"
  | "pay"
  | "cmp"
  | "bty"
  | "act"
  | "pro"
  | "cnt"
  | "res"
  | "msg"
  | "frd"
  | "whe"
  | "whd"
  | "rpt"
  | "svw"
  | "job"
  | "key"
  | "aud"
  | "inv"
  | "bpr"
  | "bcu"
  | "bcn"
  | "vis"
  | "run";

export const createId = (prefix: IdPrefix) => `${prefix}_${randomString(16)}`;

/** Human friendly codes for referral links: lowercase, no lookalike characters. */
export const createCode = (len = 6) => randomString(len, "23456789abcdefghjkmnpqrstuvwxyz");

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 40)
    .replace(/^-|-$/g, "");
}
