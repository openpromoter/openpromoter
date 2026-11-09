"use client";

import { Button, Card, CardHeader, Field, Input, InputAdornment, Select, Textarea } from "@openpromoter/ui";
import { Plus, Sparkles, Trash2 } from "@openpromoter/ui/icons";
import { useState } from "react";
import { SettingsCard } from "@/components/page";
import { useAction } from "@/components/use-action";
import {
  deleteGroupAction,
  deleteProductRateAction,
  saveGroupAction,
  saveProductRateAction,
  updateProgramAction,
} from "../settings-actions";

type P = Record<string, string>;

export function ProgramForm({
  programId,
  canWrite,
  p,
  rationale,
}: {
  programId: string;
  canWrite: boolean;
  p: P;
  rationale: Record<string, string> | null;
}) {
  const { pending, run } = useAction();
  const [type, setType] = useState(p.commissionType);
  const [duration, setDuration] = useState(p.commissionDuration);
  const [dirty, setDirty] = useState(false);
  const why = (k: string) =>
    rationale?.[k] ? (
      <span className="flex gap-1">
        <Sparkles className="mt-0.5 size-3 shrink-0 text-accent-text" />
        {rationale[k]}
      </span>
    ) : undefined;
  return (
    <form
      onChange={() => setDirty(true)}
      action={(f) =>
        run(
          () =>
            updateProgramAction(
              programId,
              Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)])),
            ),
          "Program saved",
          () => setDirty(false),
        )
      }
    >
      <fieldset disabled={!canWrite} className="flex flex-col gap-4">
        <SettingsCard title="Basics" description="Name, website and currency for commissions and payouts.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Program name" htmlFor="name">
              <Input id="name" name="name" defaultValue={p.name} required />
            </Field>
            <Field label="Website" htmlFor="websiteUrl">
              <Input id="websiteUrl" name="websiteUrl" type="url" defaultValue={p.websiteUrl} required />
            </Field>
            <Field label="Currency" htmlFor="currency" hint="ISO code such as USD or EUR">
              <Input
                id="currency"
                name="currency"
                defaultValue={p.currency}
                maxLength={3}
                required
                className="uppercase"
              />
            </Field>
            <Field label="Visibility" htmlFor="visibility">
              <Select id="visibility" name="visibility" defaultValue={p.visibility}>
                <option value="public">Public: anyone can apply</option>
                <option value="private">Private: unlisted and open by link only</option>
                <option value="invite_only">Invite only</option>
              </Select>
            </Field>
          </div>
        </SettingsCard>
        <SettingsCard title="Commission" description="What partners earn. Tiers below can override the rate.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="commissionType">
              <Select
                id="commissionType"
                name="commissionType"
                value={type}
                onValueChange={(v) => setType(v)}
              >
                <option value="percent">Percent of each payment</option>
                <option value="fixed">Fixed amount per payment</option>
              </Select>
            </Field>
            <Field label="Rate" htmlFor="commissionValue" hint={why("commission")}>
              <InputAdornment suffix={type === "percent" ? "%" : p.currency}>
                <Input
                  id="commissionValue"
                  name="commissionValue"
                  defaultValue={p.commissionValue}
                  inputMode="decimal"
                  className="num pr-12 text-right"
                  required
                />
              </InputAdornment>
            </Field>
            <Field label="Duration" htmlFor="commissionDuration" hint={why("duration")}>
              <Select
                id="commissionDuration"
                name="commissionDuration"
                value={duration}
                onValueChange={(v) => setDuration(v)}
              >
                <option value="once">First payment only</option>
                <option value="months">Recurring for N months</option>
                <option value="lifetime">Lifetime of the customer</option>
              </Select>
            </Field>
            <Field label="Months" htmlFor="commissionMonths">
              <Input
                id="commissionMonths"
                name="commissionMonths"
                type="number"
                min={1}
                max={120}
                defaultValue={p.commissionMonths}
                disabled={duration !== "months"}
                className="num"
              />
            </Field>
            <Field
              label="Then, for life"
              htmlFor="commissionAfterValue"
              hint="Optional. A lower rate paid after those months, for as long as the customer pays. Leave empty to stop."
            >
              <InputAdornment suffix={type === "percent" ? "%" : p.currency}>
                <Input
                  id="commissionAfterValue"
                  name="commissionAfterValue"
                  defaultValue={p.commissionAfterValue}
                  inputMode="decimal"
                  placeholder="None"
                  disabled={duration !== "months"}
                  className="num pr-12 text-right"
                />
              </InputAdornment>
            </Field>
            <Field
              label="Per signup (lead) reward"
              htmlFor="leadCommission"
              hint="Paid when a referred visitor signs up and before they pay. Enter 0 to turn it off."
            >
              <InputAdornment prefix={p.currency}>
                <Input
                  id="leadCommission"
                  name="leadCommission"
                  defaultValue={p.leadCommission}
                  inputMode="decimal"
                  className="num pl-12 text-right"
                />
              </InputAdornment>
            </Field>
            <Field
              label="Recruiter override"
              htmlFor="overridePercent"
              hint="Partners can recruit other partners with their own link. They earn this share of each commission their recruits earn. Enter 0 to turn it off."
            >
              <InputAdornment suffix="%">
                <Input
                  id="overridePercent"
                  name="overridePercent"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  defaultValue={p.overridePercent}
                  className="num pr-8 text-right"
                />
              </InputAdornment>
            </Field>
          </div>
        </SettingsCard>
        <SettingsCard
          title="Reward for the customer"
          description="Double-sided: offer referred customers a discount. Partners see it on the program page and in their content kit."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Discount" htmlFor="doubleSidedPercent" hint={why("doubleSided")}>
              <InputAdornment suffix="%">
                <Input
                  id="doubleSidedPercent"
                  name="doubleSidedPercent"
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={p.doubleSidedPercent}
                  className="num pr-8 text-right"
                />
              </InputAdornment>
            </Field>
            <Field label="For months" htmlFor="doubleSidedMonths">
              <Input
                id="doubleSidedMonths"
                name="doubleSidedMonths"
                type="number"
                min={0}
                max={36}
                defaultValue={p.doubleSidedMonths}
                className="num"
              />
            </Field>
            <Field
              label="Stripe coupon id"
              htmlFor="doubleSidedCoupon"
              hint="Create the coupon in Stripe. Give each partner a code on it from their partner page, and referred customers enter that code at checkout."
            >
              <Input
                id="doubleSidedCoupon"
                name="doubleSidedCoupon"
                defaultValue={p.doubleSidedCoupon}
                className="font-mono"
              />
            </Field>
          </div>
        </SettingsCard>
        <SettingsCard title="Tracking" description="How clicks turn into credit.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Cookie window" htmlFor="cookieDays" hint={why("cookie")}>
              <InputAdornment suffix="days">
                <Input
                  id="cookieDays"
                  name="cookieDays"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={p.cookieDays}
                  className="num pr-12 text-right"
                />
              </InputAdornment>
            </Field>
            <Field label="Credit goes to" htmlFor="attributionModel">
              <Select id="attributionModel" name="attributionModel" defaultValue={p.attributionModel}>
                <option value="last_click">Last click</option>
                <option value="first_click">First click</option>
              </Select>
            </Field>
            <Field label="Link parameter" htmlFor="referralParam" hint="yourapp.com/?via=code">
              <Input
                id="referralParam"
                name="referralParam"
                defaultValue={p.referralParam}
                className="font-mono"
              />
            </Field>
          </div>
        </SettingsCard>
        <SettingsCard title="Payouts" description="When commissions become payable and how often.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Refund hold" htmlFor="holdDays" hint={why("payouts")}>
              <InputAdornment suffix="days">
                <Input
                  id="holdDays"
                  name="holdDays"
                  type="number"
                  min={0}
                  max={180}
                  defaultValue={p.holdDays}
                  className="num pr-12 text-right"
                />
              </InputAdornment>
            </Field>
            <Field label="Minimum payout" htmlFor="minPayout">
              <InputAdornment prefix={p.currency}>
                <Input
                  id="minPayout"
                  name="minPayout"
                  defaultValue={p.minPayout}
                  inputMode="decimal"
                  className="num pl-12 text-right"
                />
              </InputAdornment>
            </Field>
            <Field
              label="Schedule"
              htmlFor="payoutSchedule"
              hint="Payouts are prepared on schedule and wait for your approval."
            >
              <Select id="payoutSchedule" name="payoutSchedule" defaultValue={p.payoutSchedule}>
                <option value="monthly">Monthly (1st)</option>
                <option value="weekly">Weekly (Monday)</option>
                <option value="manual">Only when I click</option>
              </Select>
            </Field>
          </div>
        </SettingsCard>
        <SettingsCard
          title="Fraud"
          description="Commissions from referrals or partners at or above this risk score are held automatically."
        >
          <Field label="Auto-hold at risk score" htmlFor="fraudHoldScore">
            <Input
              id="fraudHoldScore"
              name="fraudHoldScore"
              type="number"
              min={10}
              max={100}
              defaultValue={p.fraudHoldScore}
              className="num w-32"
            />
          </Field>
        </SettingsCard>
        <SettingsCard
          title="Terms"
          description="Shown on your program page. Partners accept them when they apply."
        >
          <Textarea
            name="terms"
            defaultValue={p.terms}
            className="h-48 font-mono text-[12px]"
            aria-label="Program terms"
          />
        </SettingsCard>
      </fieldset>
      {canWrite ? (
        <div
          className={`sticky bottom-16 z-10 mt-4 flex items-center justify-end gap-3 rounded-md border border-border bg-surface px-4 py-3 shadow-md md:bottom-4 ${dirty ? "" : "hidden"}`}
        >
          <span className="mr-auto text-[13px] text-muted">Unsaved changes</span>
          <Button type="reset" variant="ghost" onClick={() => setDirty(false)}>
            Discard
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Save
          </Button>
        </div>
      ) : null}
    </form>
  );
}

type G = { id: string; name: string; rate: string; promoteAt: string; isDefault: boolean };

export function TiersCard({
  programId,
  canWrite,
  currency,
  groups,
}: {
  programId: string;
  canWrite: boolean;
  currency: string;
  groups: G[];
}) {
  const { pending, run } = useAction();
  const [adding, setAdding] = useState(false);
  const row = (g: Partial<G>, isNew = false) => (
    <form
      key={g.id ?? "new"}
      className="grid grid-cols-2 items-end gap-3 border-t border-border px-5 py-3 sm:grid-cols-[1fr_120px_160px_auto]"
      action={(f) =>
        run(
          () =>
            saveGroupAction(programId, {
              id: g.id,
              name: String(f.get("name")),
              rate: String(f.get("rate")),
              promoteAt: String(f.get("promoteAt")),
            }),
          "Tier saved",
          () => setAdding(false),
        )
      }
    >
      <Field label="Tier" htmlFor={`g-n-${g.id ?? "new"}`}>
        <Input id={`g-n-${g.id ?? "new"}`} name="name" defaultValue={g.name} required disabled={!canWrite} />
      </Field>
      <Field label="Rate %" htmlFor={`g-r-${g.id ?? "new"}`}>
        <Input
          id={`g-r-${g.id ?? "new"}`}
          name="rate"
          defaultValue={g.rate}
          placeholder="program"
          disabled={!canWrite}
          className="num"
        />
      </Field>
      <Field label={`Promote at (${currency.toUpperCase()})`} htmlFor={`g-p-${g.id ?? "new"}`}>
        <Input
          id={`g-p-${g.id ?? "new"}`}
          name="promoteAt"
          defaultValue={g.promoteAt}
          placeholder={g.isDefault ? "start tier" : "manual"}
          disabled={!canWrite || g.isDefault}
          className="num"
        />
      </Field>
      {canWrite ? (
        <div className="flex gap-1">
          <Button type="submit" size="md" loading={pending}>
            {isNew ? "Add" : "Save"}
          </Button>
          {!g.isDefault && g.id ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Delete tier"
              onClick={() => run(() => deleteGroupAction(programId, g.id!))}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
  return (
    <Card>
      <CardHeader
        title="Tiers"
        description="Partners move up automatically when their referred revenue crosses the threshold. Leave the rate empty to use the program rate."
        action={
          canWrite ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add tier
            </Button>
          ) : null
        }
      />
      {groups.map((g) => row(g))}
      {adding ? row({}, true) : null}
    </Card>
  );
}

type R = { id: string; label: string; type: string; rate: string };

function ProductRateRow({
  programId,
  canWrite,
  currency,
  free,
  r,
  onDone,
}: {
  programId: string;
  canWrite: boolean;
  currency: string;
  /** Synced prices without a rate yet; only the new row uses them. */
  free: { id: string; label: string }[];
  r: Partial<R>;
  /** Set on the new row: closes it. */
  onDone?: () => void;
}) {
  const { pending, run } = useAction();
  const [type, setType] = useState(r.type ?? "percent");
  const isNew = !r.id;
  const key = r.id ?? "new";
  return (
    <form
      className="grid grid-cols-2 items-end gap-3 border-t border-border px-5 py-3 sm:grid-cols-[1fr_150px_120px_auto]"
      action={(f) =>
        run(
          () =>
            saveProductRateAction(programId, {
              id: r.id ?? String(f.get("price")),
              type: String(f.get("type")),
              rate: String(f.get("rate")),
            }),
          "Product rate saved",
          onDone,
        )
      }
    >
      <Field label="Price" htmlFor={`pr-p-${key}`} className="col-span-2 sm:col-span-1">
        {!isNew ? (
          <Input id={`pr-p-${key}`} value={r.label} title={r.id} readOnly disabled />
        ) : free.length ? (
          <Select id={`pr-p-${key}`} name="price">
            {free.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        ) : (
          <Input id={`pr-p-${key}`} name="price" placeholder="Price or product id" required />
        )}
      </Field>
      <Field label="Type" htmlFor={`pr-t-${key}`}>
        <Select id={`pr-t-${key}`} name="type" value={type} onValueChange={setType} disabled={!canWrite}>
          <option value="percent">Percent</option>
          <option value="fixed">Fixed amount</option>
        </Select>
      </Field>
      <Field
        label={type === "percent" ? "Rate %" : `Amount (${currency.toUpperCase()})`}
        htmlFor={`pr-r-${key}`}
      >
        <Input
          id={`pr-r-${key}`}
          name="rate"
          defaultValue={r.rate}
          required
          inputMode="decimal"
          disabled={!canWrite}
          className="num"
        />
      </Field>
      {canWrite ? (
        <div className="flex gap-1">
          <Button type="submit" size="md" loading={pending}>
            {isNew ? "Add" : "Save"}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={isNew ? "Cancel" : "Delete product rate"}
            onClick={() => (isNew ? onDone?.() : run(() => deleteProductRateAction(programId, r.id!)))}
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** Per-product rates. A payment for a listed price or product earns this rate instead of the tier or program rate. */
export function ProductRatesCard({
  programId,
  canWrite,
  currency,
  rates,
  prices,
}: {
  programId: string;
  canWrite: boolean;
  currency: string;
  rates: R[];
  prices: { id: string; label: string }[];
}) {
  const [adding, setAdding] = useState(false);
  const free = prices.filter((x) => !rates.some((r) => r.id === x.id));
  const row = { programId, canWrite, currency, free };
  return (
    <Card>
      <CardHeader
        title="Product rates"
        description="Pay a different rate on a product. It replaces the tier and program rate for that product. A rate set on one partner still comes first."
        action={
          canWrite ? (
            <Button size="sm" onClick={() => setAdding(true)} disabled={adding}>
              <Plus /> Add product rate
            </Button>
          ) : null
        }
      />
      {rates.map((r) => (
        <ProductRateRow key={`${r.id}:${r.type}:${r.rate}`} {...row} r={r} />
      ))}
      {adding ? <ProductRateRow {...row} r={{}} onDone={() => setAdding(false)} /> : null}
      {!rates.length && !adding ? (
        <p className="border-t border-border px-5 py-3 text-[13px] text-muted">
          Every product earns the program rate.
        </p>
      ) : null}
    </Card>
  );
}
