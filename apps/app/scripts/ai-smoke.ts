/**
 * One run of each AI feature against the local demo program. Prints tokens and cost per call, and with
 * --out=<file> saves every piece of text the AI wrote so it can be checked against the writing rules.
 * Run from apps/app: npx tsx --env-file=.env.local scripts/ai-smoke.ts [--with-search] [--out=ai-out.json]
 * About $0.05 with --with-search (Sonnet once for the designer, Haiku for the rest).
 * It rewrites the demo program's content kit and adds a few creator prospects. Nothing else changes.
 */
process.env.AI_LOG = "1";
// the recruiter and Autopilot import the email templates (JSX)
(globalThis as { React?: unknown }).React = await import("react");
const { contentAsset, program, prospect } = await import("@openpromoter/db");
const { and, desc, eq } = await import("drizzle-orm");
const { writeFileSync } = await import("node:fs");
const { db } = await import("@/server/db");
const { aiBudget, aiEnabled } = await import("@/server/ai/provider");
const { proposeDesign } = await import("@/server/setup");
const { generateContentKit } = await import("@/server/ai/content");
const { ask } = await import("@/server/ai/assistant");
const { draftCampaign } = await import("@/server/campaigns");
const { suggest } = await import("@/server/ai/autopilot");
const { findCreatorProspects, personalise } = await import("@/server/ai/recruiter");

if (!aiEnabled()) throw new Error("Add ANTHROPIC_API_KEY to apps/app/.env.local first.");
const [prog] = await db().select().from(program).where(eq(program.id, "prg_1Qqz8HTpJ413SyAK"));
if (!prog) throw new Error("Demo program not found. Run the seed first.");
const ws = prog.workspaceId;
const saved: { feature: string; cost: number; texts: string[] }[] = [];

async function step(feature: string, fn: () => Promise<string[]>) {
  const before = (await aiBudget(ws)).spent;
  const texts = await fn();
  const cost = ((await aiBudget(ws)).spent - before) / 1e6;
  saved.push({ feature, cost, texts });
  console.log(`\n=== ${feature}: $${cost.toFixed(4)}\n${texts.join("\n---\n").slice(0, 1200)}`);
}

await step("Program designer", async () => {
  const d = await proposeDesign(prog.id);
  return d.source === "ai" ? Object.values(d.rationale ?? {}).map(String) : ["(fell back to rules)"];
});
await step("Content kit", async () => {
  await generateContentKit(prog, { force: true });
  const rows = await db()
    .select()
    .from(contentAsset)
    .where(and(eq(contentAsset.programId, prog.id), eq(contentAsset.generatedBy, "ai")));
  return rows.filter((r) => r.kind !== "banner").map((r) => `${r.title}: ${r.body}`);
});
const q = { base: `/app/${prog.id}`, currency: prog.currency, workspaceId: ws };
await step("Assistant", async () => [(await ask(prog.id, "Who drove the most revenue last month?", q)).text]);
await step("Assistant, second question (reads the cache)", async () => [
  (await ask(prog.id, "How many partners joined this month?", q)).text,
]);
await step("Campaign from one sentence", async () => {
  const c = await draftCampaign("Double commissions for Black Friday week", prog.currency, undefined, ws);
  return c ? [c.name, c.description] : ["(no draft)"];
});
await step("Autopilot", async () =>
  (await suggest(prog)).map(
    (s) => `${s.title}: ${s.detail}${typeof s.payload.body === "string" ? `\n${s.payload.body}` : ""}`,
  ),
);
if (process.argv.includes("--with-search")) {
  await step("Creator search", async () => {
    await findCreatorProspects(prog, "product analytics for SaaS teams", 3);
    const rows = await db()
      .select()
      .from(prospect)
      .where(and(eq(prospect.programId, prog.id), eq(prospect.source, "creator")))
      .orderBy(desc(prospect.createdAt))
      .limit(3);
    return rows.map((r) => `${r.name} (${r.url}): ${r.reason}`);
  });
  await step("Invite written for one prospect", async () => {
    const [p] = await db()
      .select()
      .from(prospect)
      .where(eq(prospect.programId, prog.id))
      .orderBy(desc(prospect.createdAt))
      .limit(1);
    if (!p) return ["(no prospect)"];
    await personalise(prog, p);
    const [after] = await db().select().from(prospect).where(eq(prospect.id, p.id));
    return [`${after?.inviteSubject}\n${after?.inviteBody}`];
  });
}

const b = await aiBudget(ws);
console.log(`\nAI spend this month for the demo workspace: $${(b.spent / 1e6).toFixed(4)}`);
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
if (out) writeFileSync(out, JSON.stringify(saved, null, 2));
process.exit(0);

export {};
