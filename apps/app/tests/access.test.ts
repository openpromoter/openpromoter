import { describe, expect, it } from "vitest";
import { AccessError, can, requireProgram, requireWorkspace } from "@/server/access";
import { fixture } from "./helpers";

describe("roles and tenant isolation", () => {
  it("role matrix", () => {
    expect(can("owner", "billing.write")).toBe(true);
    expect(can("admin", "billing.write")).toBe(false);
    expect(can("finance", "money.write")).toBe(true);
    expect(can("finance", "program.write")).toBe(false);
    expect(can("viewer", "read")).toBe(true);
    expect(can("viewer", "partners.write")).toBe(false);
  });
  it("users cannot reach another workspace's program", async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(requireProgram(a.user.id, a.program.id, "money.write")).resolves.toMatchObject({
      role: "owner",
    });
    await expect(requireProgram(a.user.id, b.program.id)).rejects.toBeInstanceOf(AccessError);
    await expect(requireWorkspace(b.user.id, a.ws.id)).rejects.toMatchObject({ status: 404 });
    await expect(requireProgram(a.user.id, "prg_missing")).rejects.toMatchObject({ status: 404 });
  });
});
