import { PROGRAM_CATEGORIES, type ProgramCategory, partner, program } from "@openpromoter/db";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "./db";
import { applyToProgram } from "./partners";

export interface MarketplaceFilters {
  category?: string | null;
  type?: string | null;
}

/** Only public programs whose founder opted in. Private and invite-only programs never show. */
const listed = () => and(eq(program.listedInNetwork, true), eq(program.visibility, "public"));

export const isCategory = (c: unknown): c is ProgramCategory =>
  typeof c === "string" && (PROGRAM_CATEGORIES as readonly string[]).includes(c);

/**
 * The partner marketplace. Self-hosted it lists this instance's programs; on Cloud every tenant shares the
 * database, so it lists every opted-in program.
 */
export async function listMarketplace(f: MarketplaceFilters = {}, userId?: string | null) {
  const w: (SQL | undefined)[] = [listed()];
  if (isCategory(f.category)) w.push(eq(program.category, f.category));
  if (f.type === "percent" || f.type === "fixed") w.push(eq(program.commissionType, f.type));
  const rows = await db()
    .select()
    .from(program)
    .where(and(...w))
    .orderBy(desc(program.createdAt))
    .limit(300);
  const mine = new Map<string, (typeof partner.$inferSelect)["status"]>();
  if (userId && rows.length) {
    const joined = await db()
      .select({ programId: partner.programId, status: partner.status })
      .from(partner)
      .where(
        and(
          eq(partner.userId, userId),
          inArray(
            partner.programId,
            rows.map((r) => r.id),
          ),
        ),
      );
    for (const j of joined) mine.set(j.programId, j.status);
  }
  return rows.map((p) => ({ program: p, status: mine.get(p.id) ?? null }));
}

/** Categories that have at least one listed program, for the filter. */
export async function marketplaceCategories(): Promise<ProgramCategory[]> {
  const rows = await db().selectDistinct({ c: program.category }).from(program).where(listed());
  const have = new Set(rows.map((r) => r.c));
  return PROGRAM_CATEGORIES.filter((c) => have.has(c));
}

/** One-click apply from the marketplace with the signed-in account. Same rules as the apply form. */
export async function joinFromMarketplace(
  u: { id: string; email: string; name: string },
  slug: string,
  ip: string | null,
) {
  const [p] = await db()
    .select()
    .from(program)
    .where(and(eq(program.slug, slug), listed()));
  if (!p) throw new Error("This program is not in the marketplace");
  if (p.applicationQuestions.some((q) => q.required))
    throw new Error("This program asks a few questions. Apply from its page.");
  return applyToProgram(p, {
    email: u.email,
    name: u.name || u.email.split("@")[0]!,
    userId: u.id,
    ip,
    source: "application",
  });
}
