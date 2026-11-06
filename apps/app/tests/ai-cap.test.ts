import { program, resource, workspace } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Anthropic stand-in: counts calls and reports a fixed token usage
const models: string[] = [];
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = {
      messages: {
        create: async (req: { model: string }) => {
          models.push(req.model);
          return {
            model: req.model,
            stop_reason: "end_turn",
            usage: { input_tokens: 10_000, output_tokens: 2_000 },
            content: [{ type: "text", text: "hello" }],
          };
        },
      },
    };
  },
}));
vi.mock("@/server/env", async (orig) => {
  const m = await orig<typeof import("@/server/env")>();
  return {
    ...m,
    env: { ...m.env, ANTHROPIC_API_KEY: "test", AI_MODEL: undefined },
    isHosted: () => true,
  };
});

const { aiBudget, aiText, stripEmDashes, usageMicros, WRITING_RULES } = await import("@/server/ai/provider");
const { db } = await import("@/server/db");
const { fixture } = await import("./helpers");
const { GET } = await import("@/app/api/resources/[id]/route");

describe("AI allowance", () => {
  it("prices tokens per model", () => {
    expect(usageMicros("claude-haiku-5-5", { input_tokens: 1000, output_tokens: 1000 })).toBe(600);
    expect(usageMicros("claude-opus-5-5", { input_tokens: 1000, output_tokens: 1000 })).toBe(24_000);
    expect(
      usageMicros("claude-sonnet-5-5", { input_tokens: 0, server_tool_use: { web_search_requests: 2 } }),
    ).toBe(20_000);
  });

  it("uses the model the task needs and records what it cost", async () => {
    const f = await fixture();
    models.length = 0;
    await aiText({ system: "s", prompt: "p", workspaceId: f.ws.id });
    await aiText({ system: "s", prompt: "p", workspaceId: f.ws.id, tier: "smart" });
    expect(models).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
    // haiku 10k in + 2k out = 2,000 micros; sonnet = 40,000
    expect((await aiBudget(f.ws.id)).spent).toBe(42_000);
  });

  it("stops calling the model once the plan's allowance is used, then falls back", async () => {
    const f = await fixture();
    const month = new Date().toISOString().slice(0, 7);
    await db()
      .update(workspace)
      .set({ aiMonth: month, aiSpentMicros: 250_000 })
      .where(eq(workspace.id, f.ws.id));
    models.length = 0;
    expect(await aiText({ system: "s", prompt: "p", workspaceId: f.ws.id })).toBeNull();
    expect(models).toEqual([]);
    // a bigger plan has room again
    await db().update(workspace).set({ plan: "starter" }).where(eq(workspace.id, f.ws.id));
    expect(await aiText({ system: "s", prompt: "p", workspaceId: f.ws.id })).toBe("hello");
  });

  it("starts each month from zero", async () => {
    const f = await fixture();
    await db()
      .update(workspace)
      .set({ aiMonth: "2000-01", aiSpentMicros: 9_999_999 })
      .where(eq(workspace.id, f.ws.id));
    expect((await aiBudget(f.ws.id)).spent).toBe(0);
    await aiText({ system: "s", prompt: "p", workspaceId: f.ws.id });
    expect((await aiBudget(f.ws.id)).spent).toBe(2_000);
  });
});

describe("writing rules", () => {
  it("turns em dashes into two sentences", () => {
    expect(stripEmDashes("Tracking works — payouts too.")).toBe("Tracking works. Payouts too.");
    expect(stripEmDashes("Ranges like 9–17 stay")).toBe("Ranges like 9–17 stay");
    expect(stripEmDashes("It does no sampling, so every event counts.")).toBe(
      "It does no sampling. So every event counts.",
    );
    expect(stripEmDashes("Set it up, so that partners see it.")).toBe("Set it up, so that partners see it.");
  });

  it("the shared rules block is long enough to cache (512+ tokens, about 4 characters each)", () => {
    expect(WRITING_RULES.length / 4).toBeGreaterThan(600);
  });
});

describe("uploaded creatives", () => {
  it("serves an uploaded file and 404s a plain link", async () => {
    const f = await fixture();
    const [p] = await db().select().from(program).where(eq(program.id, f.program.id));
    const bytes = Buffer.from("%PDF-1.4 test");
    await db()
      .insert(resource)
      .values([
        {
          id: "res_file_test",
          programId: p!.id,
          title: "Brand kit",
          url: "http://localhost:3000/api/resources/res_file_test",
          fileName: "brand kit.pdf",
          fileType: "application/pdf",
          fileData: bytes,
        },
        { id: "res_link_test", programId: p!.id, title: "Loom", url: "https://loom.test/x" },
      ]);
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const res = await GET(new Request("http://x/api/resources/res_file_test?download"), ctx("res_file_test"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="brand_kit.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await GET(new Request("http://x"), ctx("res_link_test"))).status).toBe(404);
  });
});
