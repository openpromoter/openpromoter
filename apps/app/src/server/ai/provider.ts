import Anthropic from "@anthropic-ai/sdk";
import { workspace } from "@openpromoter/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { planById } from "@/lib/plans";
import { db } from "../db";
import { env, isHosted } from "../env";

/**
 * Provider-agnostic AI layer. Anthropic by default; any OpenAI-compatible
 * endpoint (OpenAI, Ollama, LM Studio) optionally. Every caller has a non-AI
 * fallback, so a null return is normal, not an error.
 */

export type AiProviderName = "anthropic" | "openai" | "none";

export function aiProvider(): AiProviderName {
  if (env.AI_PROVIDER) return env.AI_PROVIDER;
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL) return "openai";
  return "none";
}

export const aiEnabled = () => aiProvider() !== "none";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** fast = Haiku for almost everything; smart = Sonnet for the program designer, where Haiku chose worse terms. */
export type AiTier = "fast" | "smart";
const MODELS: Record<AiTier, string> = {
  fast: "claude-haiku-5-5",
  smart: "claude-sonnet-5-5",
};
/** US$ per million tokens [input, output], i.e. micro-dollars per token (research/business/SOURCES-2026-11-05.md). */
const PRICE: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};
const WEB_SEARCH_MICROS = 10_000; // $10 per 1,000 searches

/** AI_MODEL (self-host) wins; otherwise the cheapest model that does the job. */
export const anthropicModel = (tier: AiTier = "fast") => env.AI_MODEL ?? MODELS[tier];

export function usageMicros(
  model: string,
  u: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    server_tool_use?: { web_search_requests?: number | null } | null;
  },
) {
  // ponytail: unknown models are priced as Opus, cache reads as full input (over-counts, never under)
  const [inPrice, outPrice] = PRICE[model] ?? PRICE[DEFAULT_ANTHROPIC_MODEL] ?? [4, 20];
  const input =
    (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return Math.ceil(
    input * inPrice +
      (u.output_tokens ?? 0) * outPrice +
      (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_MICROS,
  );
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** This month's AI spend and the plan's allowance, in micro-dollars. */
export async function aiBudget(workspaceId: string) {
  const [ws] = await db()
    .select({ plan: workspace.plan, month: workspace.aiMonth, spent: workspace.aiSpentMicros })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  return {
    spent: ws?.month === thisMonth() ? ws.spent : 0,
    limit: planById(ws?.plan ?? "free").aiBudgetMicros,
  };
}

/** Self-host has no cap. Cloud stops calling the model once the plan's monthly allowance is used. */
export async function aiAllowed(workspaceId?: string) {
  if (!workspaceId || !isHosted()) return true;
  const b = await aiBudget(workspaceId);
  return b.spent < b.limit;
}

export async function recordAiSpend(workspaceId: string | undefined, micros: number) {
  if (!workspaceId || micros <= 0) return;
  const m = thisMonth();
  await db()
    .update(workspace)
    .set({
      aiSpentMicros: sql`case when ${workspace.aiMonth} = ${m} then ${workspace.aiSpentMicros} + ${micros} else ${micros} end`,
      aiMonth: m,
    })
    .where(eq(workspace.id, workspaceId));
}

/**
 * House writing rules (docs/CONTENT-GUIDELINES.md), sent first in every system prompt. Identical bytes on every
 * call, so it is the shared cache prefix (models here cache prefixes of 512+ tokens; keep this block above that).
 */
export const WRITING_RULES = `You write for OpenPromoter, affiliate software for SaaS founders. Founders and their partners read what you write, often on a phone, between other tasks. Every rule below applies to every word of text you produce, including JSON string values. When a task's own instructions are stricter (a word limit, plain text only), follow both.

Hard rules:
- Never use an em dash. Write two short sentences instead. An en dash in a number range such as 9–17 is fine.
- Keep every sentence to 25 words or fewer. Keep paragraphs to 3 sentences or fewer.
- No exclamation marks. No emojis. No hashtags unless the task asks for a social post that needs them.
- Use American English: license, catalog, color, canceled, recognized.
- Use plain words a busy founder understands on first read. Keep the technical terms they use, such as webhook, API key, MRR and 2FA.
- Make only claims the given data supports. Never invent numbers, ratings, reviews, testimonials, customer counts or awards.
- When the data is thin, write less. Never tell a reader what you don't know or can't claim. When the task is to answer a founder's question and the data is empty, say so plainly.

Commas only where grammar needs one:
- No stock tails such as ", in plain terms." or ", with no extra setup." Drop them.
- No contrast tags such as "X, not Y" or "not just X, it's Y". State the positive claim on its own.
- In short items (titles, labels, list items of 14 words or fewer), no stacked adjectives such as "Clean, fast code". Write one phrase: "Clean code that loads fast".
- No hidden second sentences after a comma: ", so", ", then", ", rather than", ", instead of", ", which means". End the sentence and start a new one.
- Lists read "A, B and C" with no Oxford comma. Headings and titles take no comma except in a real list.

Banned words: seamless, robust, comprehensive, bespoke, tailored, curated, powerful, innovative, cutting-edge, holistic, intuitive, effortless, meticulous, elegant, sophisticated, strategic, vital, crucial, pivotal, optimal, extensive, significant, renowned, vibrant, world-class, best-in-class, high-performance, leverage, utilize, facilitate, implement, streamline, empower, harness, bolster, supercharge, elevate, delight, unlock, ecosystem, landscape, paradigm, synergy, methodology, functionality. Never open a sentence with Furthermore, Moreover, Additionally, Notably, Crucially, Ultimately, Essentially, Clearly or Obviously.

No idioms. Say what happens: "by default" (not "out of the box"), "automatically" (not "on autopilot"), "earns its cost back" (not "pays for itself").

Avoid these AI-writing patterns: three synonyms in a row ("fast, reliable and efficient"), "-ing" tails that add fake depth ("..., streamlining the process"), "serves as" where "is" works, padding openers ("When it comes to"), signposting ("Let's dive in") and generic upbeat endings ("the possibilities are endless"). Vary sentence length. Be specific: name the product, the partner, the amount or the date.

Before you answer, reread every sentence you wrote. Split any sentence over 20 words. Wherever a comma joins two thoughts (", so", ", and we", ", but", ", which"), end the sentence there and start a new one.`;

/**
 * The two rules models break most even when told (measured 2026-11-06): em dashes, and ", so" joining two
 * thoughts. Both become two sentences: "A — b" and "A, so b" turn into "A. B" and "A. So b".
 * ", so that" and ", so far" stay, since there the comma is grammar.
 */
export function stripEmDashes(text: string) {
  return text
    .replace(/\s*—\s*(\S)/g, (_m, c: string) => `. ${c.toUpperCase()}`)
    .replaceAll("—", ".")
    .replace(/, so (?!that\b|far\b)/g, ". So ");
}

function cleanStrings<T>(value: T): T {
  if (typeof value === "string") return stripEmDashes(value) as T;
  if (Array.isArray(value)) return value.map(cleanStrings) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanStrings(v)])) as T;
  return value;
}

export interface AiTask {
  system: string;
  prompt: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** Which model size the task needs; defaults to fast. */
  tier?: AiTier;
  /** Workspace that pays: counts toward its monthly AI allowance on Cloud. */
  workspaceId?: string;
}

let anthropic: Anthropic | null = null;

/**
 * Only OpenPromoter's own key and the public API. A parent process (a desktop app, a CI runner) can leave
 * ANTHROPIC_BASE_URL or ANTHROPIC_AUTH_TOKEN set, which the SDK would otherwise pick up and fail on.
 */
export function anthropicClient() {
  anthropic ??= new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    authToken: null,
    baseURL: "https://api.anthropic.com",
  });
  return anthropic;
}

/**
 * Structured outputs want closed objects with every property required.
 *
 * Keywords structured outputs reject (a 400 for the whole call). Zod still enforces them when the answer
 * is parsed, so dropping them from the request loses nothing.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
]);

export function strictSchema(node: unknown, isPropertyMap = false): unknown {
  if (Array.isArray(node)) return node.map((n) => strictSchema(n));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    // inside "properties" the keys are field names (a field may be called "maximum"), not keywords
    if (!isPropertyMap && UNSUPPORTED_KEYWORDS.has(k)) continue;
    out[k] = strictSchema(v, !isPropertyMap && k === "properties");
  }
  if (out.type === "object" && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

async function callAnthropic(task: AiTask, schema?: Record<string, unknown>): Promise<string | null> {
  const client = anthropicClient();
  const model = anthropicModel(task.tier);
  // Haiku has no server-side refusal fallback; Sonnet and Opus fall back by refusal category
  const fallback = model.startsWith("claude-haiku")
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  const res = await client.beta.messages.create({
    model,
    max_tokens: task.maxTokens ?? 16000,
    ...fallback,
    // the shared rules block is the cache prefix; the task's own instructions follow it
    system: [
      { type: "text", text: WRITING_RULES, cache_control: { type: "ephemeral" } },
      { type: "text", text: task.system },
    ],
    output_config: {
      effort: task.effort ?? "low",
      ...(schema ? { format: { type: "json_schema" as const, schema } } : {}),
    },
    messages: [{ role: "user", content: task.prompt }],
  });
  const micros = usageMicros(res.model ?? model, res.usage);
  await recordAiSpend(task.workspaceId, micros);
  if (process.env.AI_LOG) {
    const u = res.usage;
    console.info(
      `[ai] ${res.model} in=${u.input_tokens} cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens} cost=$${(micros / 1e6).toFixed(5)}`,
    );
  }
  if (res.stop_reason === "refusal") return null;
  return res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function callOpenAiCompatible(task: AiTask, schema?: Record<string, unknown>): Promise<string | null> {
  if (!env.AI_MODEL) throw new Error("AI_MODEL is required for the openai provider");
  const base = (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.OPENAI_API_KEY ? { Authorization: `Bearer ${env.OPENAI_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      messages: [
        { role: "system", content: `${WRITING_RULES}\n\n${task.system}` },
        { role: "user", content: task.prompt },
      ],
      ...(schema
        ? { response_format: { type: "json_schema", json_schema: { name: "result", schema, strict: true } } }
        : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`AI provider returned ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? null;
}

async function call(task: AiTask, schema?: Record<string, unknown>): Promise<string | null> {
  const provider = aiProvider();
  if (provider === "none") return null;
  // over the monthly allowance: callers fall back to their templates
  if (!(await aiAllowed(task.workspaceId))) return null;
  try {
    return provider === "anthropic"
      ? await callAnthropic(task, schema)
      : await callOpenAiCompatible(task, schema);
  } catch (err) {
    // ponytail: AI is best-effort everywhere; callers fall back to templates
    console.warn(`[ai] ${provider} call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function aiText(task: AiTask): Promise<string | null> {
  const text = await call(task);
  return text === null ? null : stripEmDashes(text);
}

export async function aiJson<T extends z.ZodType>(schema: T, task: AiTask): Promise<z.infer<T> | null> {
  const json = strictSchema(z.toJSONSchema(schema)) as Record<string, unknown>;
  const text = await call(task, json);
  if (!text) return null;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    return schema.parse(cleanStrings(JSON.parse(match ? match[0] : text)));
  } catch {
    return null;
  }
}
