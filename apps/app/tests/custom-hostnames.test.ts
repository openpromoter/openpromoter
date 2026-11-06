import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addHostname,
  cloudflareOn,
  cnameTarget,
  hostnameProblem,
  removeHostname,
} from "@/server/custom-hostnames";
import { env } from "@/server/env";

type Call = { url: string; method: string; body?: string };

/** Fake Cloudflare custom_hostnames API holding `store`; records every call. */
function fakeCloudflare(store: { id: string; hostname: string; status: string; ssl: { status: string } }[]) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body as string | undefined });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer cf-test-token");
    const u = new URL(url);
    let result: unknown;
    if (method === "GET") result = store.filter((h) => h.hostname === u.searchParams.get("hostname"));
    if (method === "POST") {
      const h = { id: `ch_${store.length + 1}`, ...JSON.parse(init.body as string), status: "pending" };
      h.ssl = { status: "pending_validation" };
      store.push(h);
      result = h;
    }
    if (method === "DELETE") {
      const id = u.pathname.split("/").pop();
      store.splice(
        store.findIndex((h) => h.id === id),
        1,
      );
      result = { id };
    }
    return new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 });
  });
  return calls;
}

function cfOn() {
  Object.assign(env, {
    CLOUDFLARE_API_TOKEN: "cf-test-token",
    CLOUDFLARE_ZONE_ID: "zone1",
    CUSTOM_DOMAIN_TARGET: "domains.op.test",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, {
    CLOUDFLARE_API_TOKEN: undefined,
    CLOUDFLARE_ZONE_ID: undefined,
    CUSTOM_DOMAIN_TARGET: undefined,
  });
});

describe("custom hostnames (Cloudflare for SaaS)", () => {
  it("is off without Cloudflare settings and points CNAMEs at the app host", () => {
    expect(cloudflareOn()).toBe(false);
    expect(cnameTarget()).toBe(new URL(env.APP_URL).hostname);
  });

  it("creates the hostname with HTTP validation, once", async () => {
    cfOn();
    const store: Parameters<typeof fakeCloudflare>[0] = [];
    const calls = fakeCloudflare(store);
    await addHostname("partners.acme.test");
    await addHostname("partners.acme.test");
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe("https://api.cloudflare.com/client/v4/zones/zone1/custom_hostnames");
    expect(JSON.parse(posts[0]!.body!)).toEqual({
      hostname: "partners.acme.test",
      ssl: { method: "http", type: "dv" },
    });
  });

  it("reports pending DNS, then issuing, then ready", async () => {
    cfOn();
    const store = [
      { id: "ch_1", hostname: "partners.acme.test", status: "pending", ssl: { status: "initializing" } },
    ];
    fakeCloudflare(store);
    expect(await hostnameProblem("partners.acme.test")).toContain("Waiting for DNS");
    expect(await hostnameProblem("partners.acme.test")).toContain("domains.op.test");
    store[0]!.status = "active";
    expect(await hostnameProblem("partners.acme.test")).toContain("issuing the certificate");
    store[0]!.ssl.status = "active";
    expect(await hostnameProblem("partners.acme.test")).toBeNull();
    expect(await hostnameProblem("other.acme.test")).toContain("Save it again");
  });

  it("removes the old hostname when the domain changes", async () => {
    cfOn();
    const store = [{ id: "ch_1", hostname: "old.acme.test", status: "active", ssl: { status: "active" } }];
    const calls = fakeCloudflare(store);
    await addHostname("new.acme.test");
    await removeHostname("old.acme.test");
    expect(store.map((h) => h.hostname)).toEqual(["new.acme.test"]);
    expect(calls.find((c) => c.method === "DELETE")!.url).toMatch(/custom_hostnames\/ch_1$/);
  });

  it("shows Cloudflare's message on failure and never the token", async () => {
    cfOn();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ success: false, errors: [{ message: "Duplicate custom hostname found." }] }),
          {
            status: 409,
          },
        ),
    );
    await expect(addHostname("x.acme.test")).rejects.toThrow("Cloudflare: Duplicate custom hostname found.");
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down cf-test-token");
    });
    const err = await addHostname("x.acme.test").catch((e: Error) => e.message);
    expect(err).not.toContain("cf-test-token");
  });
});
