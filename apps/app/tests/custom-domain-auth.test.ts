import { program } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const { db } = await import("@/server/db");
const { env } = await import("@/server/env");
const { fixture } = await import("./helpers");

// Partners sign in on a founder's custom domain: only a verified one is trusted, and only for itself.
const req = (host: string) =>
  new Request("http://0.0.0.0:3000/api/auth/sign-in/email", { headers: { host } });

describe("sign-in on custom domains", () => {
  it("trusts a verified custom domain, not an unverified or unknown one", async () => {
    // auth.ts builds its adapter on import, after setup.ts has put the test database in place
    const { customDomainOrigins } = await import("@/server/auth");
    const f = await fixture();
    const host = `partners-${Date.now()}.example.test`;
    await db().update(program).set({ customDomain: host }).where(eq(program.id, f.program.id));
    expect(await customDomainOrigins(req(host))).toEqual([]);
    await db()
      .update(program)
      .set({ customDomainVerifiedAt: new Date() })
      .where(eq(program.id, f.program.id));
    expect(await customDomainOrigins(req(host))).toEqual([`https://${host}`]);
    expect(await customDomainOrigins(req("evil.example.test"))).toEqual([]);
    expect(await customDomainOrigins(req(new URL(env.APP_URL).host))).toEqual([]);
    expect(await customDomainOrigins(undefined)).toEqual([]);
  });
});

describe("partner pages on custom domains", () => {
  it("sign-in finds the program from next or from a verified custom domain", async () => {
    const { partnerProgram } = await import("@/server/partner-auth");
    const f = await fixture();
    const host = `ref-${Date.now()}.example.test`;
    const h = (hst: string) => new Headers({ host: hst });
    const app = new URL(env.APP_URL).host;
    expect((await partnerProgram(`/p/${f.program.slug}/portal`, h(app)))?.id).toBe(f.program.id);
    expect(await partnerProgram("/app", h(app))).toBeNull();
    await db().update(program).set({ customDomain: host }).where(eq(program.id, f.program.id));
    expect(await partnerProgram("/app", h(host))).toBeNull();
    await db()
      .update(program)
      .set({ customDomainVerifiedAt: new Date() })
      .where(eq(program.id, f.program.id));
    expect((await partnerProgram("/app", h(`${host}:443`)))?.id).toBe(f.program.id);
  });

  it("referral links use the verified custom domain", async () => {
    const { codeUrl, linkUrl } = await import("@/server/ref-link");
    const p = {
      slug: "acme",
      customDomain: "partners.acme.test",
      customDomainVerifiedAt: null as Date | null,
    };
    expect(linkUrl(p, "maya1")).toBe(`${env.APP_URL}/r/acme/l/maya1`);
    p.customDomainVerifiedAt = new Date();
    expect(linkUrl(p, "maya1")).toBe("https://partners.acme.test/maya1");
    expect(codeUrl(p, "maya")).toBe("https://partners.acme.test/r/acme/maya");
  });
});
