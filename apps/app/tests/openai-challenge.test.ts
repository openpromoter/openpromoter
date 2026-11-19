import { afterEach, expect, it } from "vitest";
import { GET } from "@/app/.well-known/openai-apps-challenge/route";

afterEach(() => {
  delete process.env.OPENAI_APPS_CHALLENGE;
});

it("serves the challenge token as plain text, or 404 when none is set", async () => {
  expect((await GET()).status).toBe(404);
  process.env.OPENAI_APPS_CHALLENGE = "  abc123\n";
  const r = await GET();
  expect(r.headers.get("content-type")).toContain("text/plain");
  expect(await r.text()).toBe("abc123");
});
