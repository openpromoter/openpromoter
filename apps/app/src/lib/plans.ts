/** Cloud plans: flat monthly price by partner-attributed revenue. Never a percentage of payouts. */
export const PLANS = [
  {
    id: "free",
    name: "Free",
    price: 0,
    revenueLimit: 100_000,
    /** Monthly AI allowance in micro-dollars (Cloud). */
    aiBudgetMicros: 250_000,
    features: [
      "Everything in OpenPromoter",
      "Up to $1k/mo partner revenue",
      "Unlimited partners",
      "AI program setup",
      "OpenPromoter badge on portal",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    price: 2900,
    revenueLimit: 1_000_000,
    /** Monthly AI allowance in micro-dollars (Cloud). */
    aiBudgetMicros: 1_000_000,
    features: ["Up to $10k/mo partner revenue", "Custom domain", "Remove badge", "AI included"],
  },
  {
    id: "growth",
    name: "Growth",
    price: 7900,
    revenueLimit: 5_000_000,
    /** Monthly AI allowance in micro-dollars (Cloud). */
    aiBudgetMicros: 3_000_000,
    features: [
      "Up to $50k/mo partner revenue",
      "Everything in Starter",
      "3x the AI of Starter",
      "Priority support",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    price: 19900,
    revenueLimit: 25_000_000,
    /** Monthly AI allowance in micro-dollars (Cloud). */
    aiBudgetMicros: 10_000_000,
    features: ["Up to $250k/mo partner revenue", "Everything in Growth", "10x the AI of Starter"],
  },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];
export const planById = (id: string) => PLANS.find((p) => p.id === id) ?? PLANS[0];
/** Stripe Price lookup keys created by the owner in OpenPromoter's own Stripe account. */
export const lookupKey = (id: PlanId) => `openpromoter_${id}_monthly`;
