import { member, partner, partnerGroup, program, user, workspace } from "@openpromoter/db";
import { createCode, createId } from "@/lib/id";
import { db } from "@/server/db";

export async function fixture(overrides: Partial<typeof program.$inferInsert> = {}) {
  const ws = { id: createId("ws"), name: "Acme", slug: `acme-${createCode(6)}` };
  await db().insert(workspace).values(ws);
  const u = { id: crypto.randomUUID(), name: "Founder", email: `founder-${createCode(6)}@acme.test` };
  await db().insert(user).values(u);
  await db().insert(member).values({ workspaceId: ws.id, userId: u.id, role: "owner" });
  const [prog] = await db()
    .insert(program)
    .values({
      id: createId("prg"),
      workspaceId: ws.id,
      name: "Acme",
      slug: `acme-${createCode(6)}`,
      websiteUrl: "https://acme.test",
      brand: { color: "#0B7A60" },
      autoApprove: {
        enabled: true,
        maxRiskScore: 40,
        requireWebsite: false,
        blockedCountries: [],
        allowedEmailDomains: [],
      },
      doubleSided: { enabled: false, percentOff: 0, durationMonths: 0 },
      holdDays: 30,
      minPayout: 5000,
      ...overrides,
    })
    .returning();
  const [grp] = await db()
    .insert(partnerGroup)
    .values({ id: createId("grp"), programId: prog!.id, name: "Partner", isDefault: true })
    .returning();
  return { ws, user: u, program: prog!, group: grp! };
}

export async function addPartner(
  programId: string,
  workspaceId: string,
  over: Partial<typeof partner.$inferInsert> = {},
) {
  const [p] = await db()
    .insert(partner)
    .values({
      id: createId("prt"),
      programId,
      workspaceId,
      email: `p-${createCode(6)}@partner.test`,
      name: "Pat Partner",
      code: createCode(6),
      status: "approved",
      approvedAt: new Date(),
      ...over,
    })
    .returning();
  return p!;
}
