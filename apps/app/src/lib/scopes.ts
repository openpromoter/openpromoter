export const API_SCOPES = [
  "read",
  "partners:write",
  "tracking:write",
  "commissions:write",
  "payouts:request",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABELS: Record<ApiScope, string> = {
  read: "Read everything",
  "partners:write": "Create and update partners, links and codes",
  "tracking:write": "Record clicks, leads and conversions",
  "commissions:write": "Create commissions and bonuses",
  "payouts:request": "Prepare payouts (a person still approves them)",
};
