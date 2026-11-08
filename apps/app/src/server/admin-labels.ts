// Plain labels shared by the admin pages and the admin table (a client component): no server code here.

/** Plan payment state as a coloured badge: green paying, red failing, grey ended. */
export const BILLING_TONE: Record<string, "success" | "danger" | "warning" | "neutral" | "info"> = {
  active: "success",
  trialing: "info",
  past_due: "danger",
  unpaid: "danger",
  incomplete: "warning",
  incomplete_expired: "neutral",
  canceled: "neutral",
};
export const billingLabel = (s: string) =>
  s === "past_due" ? "Payment failing" : s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
