import { member, partner, session, user } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { currentUser } from "@/server/context";
import { db } from "@/server/db";

/** GDPR: everything stored about the signed-in person. */
export async function GET() {
  const u = await currentUser();
  if (!u) return new Response("Sign in", { status: 401 });
  const [me] = await db().select().from(user).where(eq(user.id, u.id));
  const data = {
    user: me,
    memberships: await db().select().from(member).where(eq(member.userId, u.id)),
    // the founder's private notes, the fraud score and the signup IP hash are the program's records, not
    // the partner's: handing back the risk score would show a partner how close they are to a fraud hold
    partnerAccounts: (await db().select().from(partner).where(eq(partner.userId, u.id))).map(
      ({ taxIdEnc, notes: _notes, riskScore: _risk, signupIpHash: _ip, externalId: _ext, ...rest }) => ({
        ...rest,
        taxId: taxIdEnc ? "stored (encrypted)" : null,
      }),
    ),
    sessions: (await db().select().from(session).where(eq(session.userId, u.id))).map((s) => ({
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      userAgent: s.userAgent,
    })),
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="openpromoter-data.json"',
    },
  });
}
