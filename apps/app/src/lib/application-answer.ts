import type { ApplicationQuestion } from "@openpromoter/db";

/** Multiple choice answers travel as one field, joined by this (a choice can't contain it). */
export const MULTI_SEP = "\u001f";

/**
 * The stored answer for one question, or "" when unanswered. Choices must be one of the founder's
 * options (a crafted request can't store anything else), a checkbox is "Yes", text is capped.
 */
export function applicationAnswer(q: ApplicationQuestion, raw: string): string {
  const opts = q.options ?? [];
  if (q.type === "checkbox") return raw === "on" || raw === "Yes" ? "Yes" : "";
  if (q.type === "select") return opts.includes(raw) ? raw : "";
  if (q.type === "multi") return opts.filter((o) => raw.split(MULTI_SEP).includes(o)).join(", ");
  return raw.trim().slice(0, 4000);
}
