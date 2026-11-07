import { commission, partner, program } from "@openpromoter/db";
import { and, eq } from "drizzle-orm";
import { toMajor } from "@/lib/money";
import { currentUser } from "@/server/context";
import { db } from "@/server/db";
import { csvStream, keyset } from "@/server/exports";

const COLUMNS = ["date", "description", "status", "amount", "currency", "payable_from"];

/** The partner's full commission history; the Earnings page only shows 50 at a time. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const u = await currentUser();
  if (!u) return new Response("Sign in", { status: 401 });
  const [row] = await db()
    .select({ partnerId: partner.id })
    .from(partner)
    .innerJoin(program, eq(program.id, partner.programId))
    .where(and(eq(program.slug, slug), eq(partner.userId, u.id)));
  if (!row) return new Response("Not found", { status: 404 });

  const pages = keyset(
    commission,
    (after, order, limit) =>
      db()
        .select()
        .from(commission)
        .where(and(eq(commission.partnerId, row.partnerId), after))
        .orderBy(...order)
        .limit(limit),
    (r) => r,
  );
  async function* rows() {
    for await (const page of pages)
      yield page.map((r) => ({
        date: r.createdAt.toISOString().slice(0, 10),
        description: r.description ?? r.kind,
        status: r.status,
        amount: toMajor(r.amount, r.currency),
        currency: r.currency.toUpperCase(),
        payable_from: r.status === "pending" && r.holdUntil ? r.holdUntil.toISOString().slice(0, 10) : "",
      }));
  }
  return csvStream(`${slug}-earnings.csv`, COLUMNS, rows());
}
