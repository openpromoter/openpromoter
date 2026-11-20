# Product Marketing Context

*Last updated: 2026-11-20. Drafted from README, launch kit and research/MARKET.md. Owner has not reviewed it yet.*

## Product Overview
**One-liner:** Open-source affiliate and referral program software for SaaS, with 0% fees on payouts.
**What it does:** Partners get a link or coupon. Every paid sale from them becomes a commission, tracked through Stripe, Paddle, Lemon Squeezy, Polar, Chargebee or Dodo Payments. Risky commissions are held, and the founder approves each payout batch.
**Category:** Affiliate software / partner program software (people search "Rewardful alternative", "FirstPromoter alternative", "open source affiliate software").
**Type:** Open-source SaaS (AGPL-3.0), self-host or Cloud.
**Pricing:** Self-host free. Cloud Free until partners bring $1k a month, then $29 (to $10k), $79 (to $50k), $199 (to $250k). 0% of payouts on every plan.

## Target Audience
**Target companies:** SaaS companies billing through Stripe (also Paddle, Lemon Squeezy, Polar, Chargebee), solo founders to small teams.
**Decision-makers:** Founder or head of growth.
**Primary use case:** Run an affiliate, referral or agency partner program without paying $49 to $99 a month plus a cut of payouts.
**Jobs to be done:**
- Turn customers and creators into a sales channel.
- Pay partners correctly, including after refunds.
- Move off a paid tool without losing links or balances.
**Segments to reach first:** (1) founders already on Rewardful, FirstPromoter or Tolt (list in launch/outbound/rewardful-prospects.csv), (2) founders about to start a program, (3) self-hosters.

## Problems & Pain Points
**Core problem:** Partner programs break in boring ways: refunds after payout, self-referrals, spreadsheet payouts.
**Why alternatives fall short:** Entry prices of $49 to $99 a month, some take 2% to 5% of payouts, the good ones are closed source.
**Emotional tension:** Fear of paying the wrong person and of lock-in.

## Competitive Landscape
**Direct:** Rewardful ($49, 3% on Managed Payouts), FirstPromoter ($49), Tolt ($99, 2% of payouts), Dub Partners ($81, 5% to 8%), PartnerStack (demo-only quote).
**Secondary:** Spreadsheets plus manual PayPal payouts.
**Indirect:** Building it in-house.

## Differentiation
- Open source and self-hostable with every feature included.
- 0% of payouts on every plan.
- Many billing systems at once.
- CSV import keeps `?via=`, `?fpr=`, `?ref=`, `?gspk=`, `?aff=` links working.
- Fraud scoring before money moves, human approves every payout, AI is optional.
- MCP server and remote connector for Claude, ChatGPT and coding agents.

## Objections
| Objection | Response |
|-----------|----------|
| Is it as mature as Rewardful? | Show the live demo, the import path and the feature list. Let them try it free. |
| Self-hosting sounds like work | One `docker compose up`, or use Cloud free. |
| Why AGPL? | Your own copy has no limits. It only stops someone reselling a closed fork. |

**Anti-persona:** Programs paying out more than $250k partner revenue a month who need enterprise contracts today.

## Switching Dynamics
**Push:** Monthly fee, payout cut, closed source.
**Pull:** 0% fees, free tier, import, self-host option.
**Habit:** Partners already have links.
**Anxiety:** Losing partner links, balances and history. Answer: links keep working, balances import.

## Customer Language
- "Rewardful alternative", "FirstPromoter alternative", "open source affiliate software", "Stripe affiliate program", "referral program for SaaS".
**Words to use:** partner, commission, payout, 0% of payouts, self-host.
**Words to avoid:** leverage, unlock, seamless, em dashes, any self-critique in public copy (owner rule 2026-11-20).

## Brand Voice
Plain words, direct, founder-to-founder. Follow docs/CONTENT-GUIDELINES.md.

## Proof Points
**Metrics (real only):** 28 GitHub stars, 5 forks, 20+ directory listings, listed in the official MCP registry and the Claude connectors directory. Security fixes from a contributor audit merged (PR #3).
**Customers:** none to quote yet. Never invent any.
| Theme | Proof |
|-------|-------|
| 0% payouts | plans.ts, pricing page |
| Live demo, no signup | openpromoter.com/demo/ |
| Migration | Settings > Import, README section |

## Goals
**Business goal:** First 20 programs connected to Stripe, then paying Cloud plans.
**Conversion action:** Open the demo, then sign up and connect Stripe (or `docker compose up`).
**Current metrics:** GitHub 868 views and 133 unique visitors in 14 days. Google: 9 clicks and 549 impressions in 28 days, average position 55.
