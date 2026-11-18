# Full Migration Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A founder moving from Rewardful, FirstPromoter, Tolt or PartnerStack brings over their partners, the customers those partners referred, each partner's unpaid balance and each partner's paid-to-date total, so nobody loses a commission and recurring commissions carry on.

**Architecture:** Everything stays CSV, on the existing **Settings > Import** page, which gets a "What's in this file" choice: Partners, Referred customers, Balances. Recurring commissions already follow `referral.externalCustomerId` (`resolveReferral` in `apps/app/src/server/ingest.ts:136` returns an existing referral for that billing customer before any other attribution), so importing referrals keyed by the Stripe/Paddle customer id is enough to keep renewals paying the right partner. A referral imported with only a customer email and no click matches the customer's next payment through the email lead branch (`ingest.ts:281`, no cookie window when `clickId` is null). Balances become `commission` rows of kind `adjustment` with a fixed `sourceKey`, so re-importing the same file never doubles money.

**Tech Stack:** Next.js server actions, Drizzle on Postgres, Vitest with PGlite (`apps/app/tests/setup.ts`), helpers `fixture` and `addPartner` in `apps/app/tests/helpers.ts`.

**Spec:** This plan. The gap it closes was found by reading `apps/app/src/server/importer.ts`: it imports partners only, rewrites codes, and imports no referrals, commissions or balances.

## Global Constraints

- All copy follows `docs/CONTENT-GUIDELINES.md`: no em dashes, plain words, no uppercase labels, no negative self-copy.
- No new dependencies. Reuse `parseCsv`, `mapHeaders`-style aliases, `toMinor` (`apps/app/src/lib/money.ts:68`), `createId`, `audit`.
- No emails, webhooks, bounties or lead commissions fire during an import (do not call `afterNewReferral` or `createManualCommission`; both have side effects).
- Every import is idempotent: running the same file twice creates nothing new the second time.
- Row cap stays 5,000 per file; file cap stays 5 MB (`settings-actions.ts:994`).
- Commit straight to `main` (owner rule). Design change in Task 4 needs before and after screenshots of the Import card sent to the owner side by side.

## Review Focus

1. **Partner code with a dash, underscore or dot** (`john-doe`, `jane_s`, `a.b`): it must be stored exactly as exported so `?via=john-doe` still matches. Today `slugify(...).replace(/-/g, "")` turns it into `johndoe`. Test in Task 1.
2. **Code already taken by a different partner**: today a random suffix is added silently and that partner's old links die. The row must be skipped and reported by email and code, never renamed. Test in Task 1.
3. **Referral row whose partner is not in OpenPromoter yet** (balances or referrals imported before partners): row is skipped and listed, nothing half-created. Tests in Tasks 2 and 3.
4. **Money written as `$1,234.50` or `1234.5`**: must parse to `123450` minor units; a value that does not parse skips the row rather than writing 0. Test in Task 3.
5. **Customer already referred in OpenPromoter** (same `externalCustomerId` in this program): the existing referral wins and the row is counted as skipped. Test in Task 2.

---

### Task 1: Keep partner codes exactly as exported

**Files:**
- Modify: `apps/app/src/server/importer.ts` (the `code` block around lines 97-105 and the return value)
- Modify: `apps/app/src/app/app/[programId]/settings/import/form.tsx` (show conflicts in the result line)
- Test: `apps/app/tests/import.test.ts` (new)

**Interfaces:**
- Produces: `export function cleanCode(raw: string): string` in `importer.ts`. Keeps `[A-Za-z0-9_.-]`, drops everything else, trims, max 64 chars (matches `attribution.ts:98`). Case is kept; lookups are already `lower()`.
- Produces: `importPartners` now returns `{ created: number; skipped: number; columns: string[]; conflicts: string[] }`. Each conflict reads `"<email>: code <code> belongs to another partner"`.
- Produces: `export async function findPartnerByRef(programId: string, ref: { email?: string; code?: string }): Promise<Partner | null>` in `importer.ts`, email first then `lower(code)`. Tasks 2 and 3 use it.

- [ ] **Step 1: Write the failing tests** in `apps/app/tests/import.test.ts`

```ts
it("keeps dashes, underscores and dots in codes", async () => {
  const f = await fixture();
  await importPartners(f.program.id, "email,referral_code\na@x.io,john-doe\nb@x.io,jane_s\nc@x.io,a.b", SYSTEM);
  const codes = (await db().select().from(partner).where(eq(partner.programId, f.program.id))).map((p) => p.code).sort();
  expect(codes).toEqual(["a.b", "jane_s", "john-doe"]);
});
it("skips a code another partner owns instead of renaming it", async () => {
  const f = await fixture();
  await importPartners(f.program.id, "email,referral_code\na@x.io,maya", SYSTEM);
  const r = await importPartners(f.program.id, "email,referral_code\nb@x.io,MAYA", SYSTEM);
  expect(r.created).toBe(0);
  expect(r.conflicts).toEqual(["b@x.io: code MAYA belongs to another partner"]);
});
```

- [ ] **Step 2: Run** `pnpm --filter app test import` and expect both to FAIL (`johndoe`, and a created partner `maya` plus suffix).
- [ ] **Step 3: Implement** `cleanCode` and swap it in for the `slugify(...).replace(/-/g, "")` on the code column only. Keep the slugified name fallback when the file has no code column. The taken check uses `lower(code)` and, when the row brought its own code, pushes a conflict and `continue`s; the `createCode(3)` suffix stays only for generated fallback codes. Add `findPartnerByRef`.
- [ ] **Step 4: Run** `pnpm --filter app test import campaigns` and expect PASS (the existing `partner import` test in `campaigns.test.ts:147` must still pass).
- [ ] **Step 5: Commit** `Import keeps partner codes exactly as exported and reports a code another partner owns instead of renaming it`

### Task 2: Import referred customers

**Files:**
- Modify: `apps/app/src/server/importer.ts`
- Test: `apps/app/tests/import.test.ts`

**Interfaces:**
- Consumes: `findPartnerByRef`, `parseCsv` (Task 1).
- Produces: `export async function importReferrals(programId: string, csv: string, actor: Actor): Promise<{ created: number; skipped: number; columns: string[]; missing: string[] }>`. `missing` lists rows whose partner was not found, as `"row <n>: no partner <email or code>"`, max 50 entries.

Column aliases (add a second alias map, `REFERRAL_ALIASES`, normalized the same way as `mapHeaders`):
- `partnerEmail`: `partner_email`, `affiliate_email`, `promoter_email`
- `partnerCode`: `referral_code`, `ref_id`, `token`, `via`, `affiliate_code`, `promoter_ref_id`, `partner_key`
- `customerId`: `stripe_customer_id`, `customer_id`, `uid`, `external_id`, `paddle_customer_id`, `customer_key`
- `email`: `email`, `customer_email`, `lead_email`
- `name`: `name`, `customer_name`
- `status`: `status`, `state`
- `convertedAt`: `converted_at`, `conversion_date`, `became_customer_at`, `first_payment_at`, `created_at`

Status mapping: `canceled|cancelled|churned` → `canceled`; `trialing|trial` → `trialing`; `lead|signup|visitor|pending` with no customer id → `lead`; anything else with a customer id → `active`. `convertedAt` set only when the status is `active`, `canceled` or `trialing`, parsed with `new Date()`, ignored when invalid.

- [ ] **Step 1: Write the failing tests**

```ts
it("imports a referral so the next renewal pays the old partner", async () => {
  const f = await fixture();
  const p = await addPartner(f.program.id, f.ws.id);
  const r = await importReferrals(f.program.id, `partner_email,stripe_customer_id,customer_email,status\n${p.email},cus_9,c@x.io,active`, SYSTEM);
  expect(r.created).toBe(1);
  await ingest(f.ws.id, "stripe", evt([payment("cus_9")]));   // reuse evt/payment from ingest.test.ts via a shared helper
  const rows = await db().select().from(commission).where(eq(commission.partnerId, p.id));
  expect(rows).toHaveLength(1);
});
it("matches an email-only referral on the customer's first payment", async () => { /* no customer id column, payment with email c@x.io and customerId cus_new → one commission for the partner */ });
it("skips a customer that is already referred and lists rows with no partner", async () => {
  /* import the same cus_9 twice → second run created 0, skipped 1; a row with partner_email nobody@x.io → missing ["row 2: no partner nobody@x.io"] */
});
it("sends no lead commission and no email on import", async () => { /* program with a lead reward: commission count for the partner stays 0 after importReferrals */ });
```

Move `evt` and `payment` from `ingest.test.ts:13-37` into `apps/app/tests/helpers.ts` and import them in both files.

- [ ] **Step 2: Run** `pnpm --filter app test import` and expect FAIL (`importReferrals` is not exported).
- [ ] **Step 3: Implement** `importReferrals`. Insert into `referral` with `via: "manual"`, `test: false`, `onConflictDoNothing()` on `(programId, externalCustomerId)`; a null result counts as skipped. Rows with neither customer id nor email are skipped. One `audit(..., "referral.import", ...)` at the end with `{ created, skipped }`.
- [ ] **Step 4: Run** `pnpm --filter app test import ingest` and expect PASS.
- [ ] **Step 5: Commit** `Import referred customers so renewals keep paying the partner who brought them`

### Task 3: Import unpaid balances and paid-to-date totals

**Files:**
- Modify: `apps/app/src/server/importer.ts`
- Test: `apps/app/tests/import.test.ts`

**Interfaces:**
- Consumes: `findPartnerByRef`, `toMinor(major, currency)`.
- Produces: `export async function importBalances(programId: string, csv: string, actor: Actor): Promise<{ created: number; skipped: number; columns: string[]; missing: string[] }>`.
- Produces: `export function parseAmount(raw: string): number | null` (major units; strips currency symbols, spaces and thousands commas; `null` when not a finite number).

Column aliases: partner by `email`/`partner_email`/`affiliate_email` or the code aliases from Task 2; `unpaid`: `unpaid`, `balance`, `unpaid_balance`, `amount_due`, `pending_balance`, `current_balance`; `paid`: `paid`, `total_paid`, `paid_out`, `lifetime_paid`.

Each row writes up to two `commission` rows in the program's currency, `fxRate: 1`, `kind: "adjustment"`, `description: "Balance brought over from your previous tool"` / `"Paid out in your previous tool"`:
- unpaid > 0 → `status: "approved"`, `sourceKey: "import:unpaid:<partnerId>"` (shows in the next payout).
- paid > 0 → `status: "paid"`, `sourceKey: "import:paid:<partnerId>"`, `payoutId: null` (counts toward lifetime paid only).

`onConflictDoNothing()` on the source key makes a second run a no-op; a conflict counts as skipped.

- [ ] **Step 1: Write the failing tests**

```ts
it("parses money the way exports write it", () => {
  expect(parseAmount("$1,234.50")).toBe(1234.5);
  expect(parseAmount("1234.5")).toBe(1234.5);
  expect(parseAmount("abc")).toBeNull();
});
it("brings over unpaid and paid totals once", async () => {
  const f = await fixture();
  const p = await addPartner(f.program.id, f.ws.id);
  const csv = `email,unpaid,total_paid\n${p.email},"$120.00",900`;
  expect((await importBalances(f.program.id, csv, SYSTEM)).created).toBe(2);
  expect((await importBalances(f.program.id, csv, SYSTEM)).created).toBe(0);
  const bal = await balances(f.program.id, [p.id]);               // ledger.ts:366
  expect(mainBalance(bal, f.program.currency)).toMatchObject({ approved: 12000, paid: 90000 });
});
it("skips a row whose amount does not parse", async () => { /* unpaid "n/a" → created 0, skipped 1 */ });
```

Also check that `payableBalances` (`ledger.ts:388`) picks up the imported unpaid row so it lands in the next payout run.

- [ ] **Step 2: Run** `pnpm --filter app test import` and expect FAIL.
- [ ] **Step 3: Implement** `parseAmount` and `importBalances`. Audit `"balance.import"` with `{ created, skipped }`.
- [ ] **Step 4: Run** `pnpm --filter app test` (whole suite, since paid rows without a payout touch payout and earnings views) and expect PASS.
- [ ] **Step 5: Check by hand** that a partner with an imported paid row still renders on the partner page, in the portal earnings page and in `p/[slug]/portal/earnings/csv` with no crash on `payoutId: null`.
- [ ] **Step 6: Commit** `Import each partner's unpaid balance and paid-to-date total from the old tool`

### Task 4: One Import card with three file types

**Files:**
- Modify: `apps/app/src/app/app/[programId]/settings/import/form.tsx`
- Modify: `apps/app/src/app/app/[programId]/settings-actions.ts:991` (`importPartnersAction`)
- Modify: `apps/app/e2e/full-settings.spec.ts` (only if its selectors change)

**Interfaces:**
- Consumes: `importPartners`, `importReferrals`, `importBalances`.
- Produces: `importAction(programId: string, kind: "partners" | "referrals" | "balances", csv: string)` replacing `importPartnersAction`, same `safe`/`actionCtx(programId, "partners.write")`/size check.

UI: a segmented control above the file input with three options, in this order, with the order hint under it: "Import partners first, then referred customers, then balances." Each option swaps the description and the textarea placeholder:
- Partners: today's copy and sample.
- Referred customers: "Export your referrals or customers from the old tool. Each row needs the partner's email or code and the customer's billing id or email. Renewals from these customers keep paying the same partner." Sample `partner_email,stripe_customer_id,customer_email,status`.
- Balances: "Export each partner's unpaid and paid amounts. Unpaid amounts show up in the next payout. Paid amounts count toward each partner's lifetime total." Sample `partner_email,unpaid,total_paid`.

Result line lists `conflicts` and `missing` (first 10, then "and N more").

- [ ] **Step 1: Take before screenshots** of the Import card (light and dark) with the local app.
- [ ] **Step 2: Implement** the control with the existing `@openpromoter/ui` segmented or tabs component (look in `packages/ui` for what Plan & billing uses for its Monthly/Yearly switch and reuse it).
- [ ] **Step 3: Run** `pnpm --filter app e2e full-settings` and expect PASS; import a small file of each kind by hand and see the counts.
- [ ] **Step 4: Take after screenshots**, send before and after side by side to the owner.
- [ ] **Step 5: Commit** `Settings > Import takes partners, referred customers and balances`

### Task 5: Say it on the site and in the README

**Files:**
- Modify: `README.md:65` and `:135`
- Modify in `../openpromoter-site`: `apps/www/content/docs/team-and-access.md` (the "Import partners from another tool" section), `apps/www/content/docs/getting-started.md:75`, `apps/www/lib/compare.ts:292` and `:1372`, `apps/www/app/changelog/page.tsx` (new entry)

- [ ] **Step 1:** Rewrite the import section as three steps (partners, referred customers, balances) with which export to pull from each tool. Before writing per-tool export steps, check each tool's help docs for the real export names; say only what the docs confirm.
- [ ] **Step 2:** Replace "CSV import of partners" claims with "partners, referred customers and balances", and the FAQ answer at `compare.ts:292` with one that says renewals keep paying the same partner.
- [ ] **Step 3:** Run the site build (`nvm use 22 && pnpm build` in `../openpromoter-site`) and expect it to pass; run the content-guidelines checks the site has.
- [ ] **Step 4: Commit** in each repo: `Docs: switching brings partners, referred customers and balances`

---

Skipped on purpose: pulling data straight from each tool's API (needs per-tool keys and code paths; add when a founder asks), importing old click history (no use for payouts), importing single past commissions row by row (the paid-to-date total covers what partners see).
