/**
 * Message catalog. Shell, navigation and shared labels read from here so a locale can be added by
 * copying `en` and switching `locale`. ponytail: one locale today; add a cookie/Accept-Language switch with the second.
 */
const en = {
  "nav.program": "Program",
  "nav.grow": "Grow",
  "nav.insight": "Insight",
  "nav.dashboard": "Dashboard",
  "nav.partners": "Partners",
  "nav.customers": "Customers",
  "nav.commissions": "Commissions",
  "nav.payouts": "Payouts",
  "nav.autopilot": "Autopilot",
  "nav.recruiter": "Recruiter",
  "nav.campaigns": "Campaigns",
  "nav.content": "Content kit",
  "nav.messages": "Messages",
  "nav.analytics": "Analytics",
  "nav.fraud": "Fraud",
  "nav.ask": "Ask AI",
  "nav.settings": "Settings",
  "nav.docs": "Docs",
  "nav.more": "More",
  "shell.search": "Search or jump…",
  "shell.signOut": "Sign out",
  "shell.theme": "Theme",
  "shell.newProgram": "New program",
} as const;

export type MessageKey = keyof typeof en;
const catalogs: Record<string, Record<MessageKey, string>> = { en };
const locale = "en";

export const t = (key: MessageKey): string => catalogs[locale]?.[key] ?? en[key];
