import {
  commission,
  link,
  message,
  partner,
  partnerGroup,
  program,
  promoCode,
  prospect,
  user,
} from "@openpromoter/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { hashIp } from "@/lib/crypto";
import { createCode, createId, slugify } from "@/lib/id";
import { type Actor, audit } from "./audit";
import { db } from "./db";
import { sendNotice } from "./email";
import { env } from "./env";
import { enqueue } from "./jobs";
import { followOverrides } from "./ledger";
import { limit } from "./ratelimit";

type Program = typeof program.$inferSelect;
type Partner = typeof partner.$inferSelect;

export interface ApplicationInput {
  email: string;
  name: string;
  website?: string | null;
  country?: string | null;
  answers?: Record<string, string>;
  userId?: string | null;
  ip?: string | null;
  source?: Partner["source"];
  /** Two-tier: code of the partner whose recruit link was used. */
  recruiterCode?: string | null;
}

/** Decide auto-approval; returns a reason when the application must wait for a human. */
export function autoApproveDecision(
  prog: Pick<Program, "autoApprove" | "visibility">,
  a: { email: string; website?: string | null; country?: string | null; riskScore: number; invited: boolean },
): { approve: boolean; reason: string } {
  const r = prog.autoApprove;
  if (a.invited) return { approve: true, reason: "Invited by you" };
  if (!r.enabled) return { approve: false, reason: "Auto-approve is off" };
  if (prog.visibility === "invite_only") return { approve: false, reason: "Program is invite-only" };
  if (a.riskScore > r.maxRiskScore)
    return { approve: false, reason: `Risk score ${a.riskScore} is above ${r.maxRiskScore}` };
  if (r.requireWebsite && !a.website) return { approve: false, reason: "No website given" };
  if (a.country && r.blockedCountries.includes(a.country.toUpperCase()))
    return { approve: false, reason: `Country ${a.country} is blocked` };
  const domain = a.email.split("@")[1]?.toLowerCase() ?? "";
  if (r.allowedEmailDomains.length && !r.allowedEmailDomains.includes(domain))
    return { approve: false, reason: "Email domain is not on the allow list" };
  return { approve: true, reason: "Matched your auto-approve rules" };
}

const DISPOSABLE =
  /@(mailinator|guerrillamail|10minutemail|tempmail|trashmail|yopmail|sharklasers|getnada|dispostable)\./i;

export function applicationRisk(a: { email: string; website?: string | null }): number {
  let s = 0;
  if (DISPOSABLE.test(a.email)) s += 60;
  if (!a.website) s += 10;
  if (/^\d+@/.test(a.email)) s += 10;
  return Math.min(100, s);
}

async function uniqueCode(programId: string, preferred: string) {
  let code = slugify(preferred).replace(/-/g, "").slice(0, 16) || createCode();
  for (let i = 0; i < 5; i++) {
    const [taken] = await db()
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.programId, programId), eq(partner.code, code)));
    if (!taken) return code;
    code = `${code.slice(0, 12)}${createCode(3)}`;
  }
  return createCode(8);
}

/**
 * A signed-in account may take over a partner record someone else created (invite, import, API) only once
 * it has proven the email: Better Auth sign-up doesn't verify addresses, so anyone could register bob@… and
 * claim Bob's commissions. Unverified accounts get a verification link and must apply again after it.
 */
async function assertCanClaim(prog: Program, userId: string, email: string) {
  const [u] = await db().select({ verified: user.emailVerified }).from(user).where(eq(user.id, userId));
  if (u?.verified) return;
  if ((await limit(`claim-verify:${email}`, 3, 3_600_000)).ok) {
    const { auth } = await import("./auth");
    await auth.api
      .sendVerificationEmail({ body: { email, callbackURL: `/p/${prog.slug}/apply` } })
      .catch((e: Error) => console.error(`[partners] verification email: ${e.message}`));
  }
  throw new Error(
    `This partner account already exists. We sent a confirmation link to ${email}. Open it and apply again to connect it.`,
  );
}

export async function applyToProgram(
  prog: Program,
  input: ApplicationInput,
  invited = false,
): Promise<{ partner: Partner; autoApproved: boolean; reason: string }> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db()
    .select()
    .from(partner)
    .where(and(eq(partner.programId, prog.id), eq(partner.email, email)));
  if (existing) {
    if (input.userId && !existing.userId) {
      await assertCanClaim(prog, input.userId, email);
      await db().update(partner).set({ userId: input.userId }).where(eq(partner.id, existing.id));
    }
    return { partner: existing, autoApproved: existing.status === "approved", reason: "Already applied" };
  }
  // "invited" from the public apply form only counts when the recruiter really sent this address an invite
  if (invited && input.source === "recruiter") {
    const [pr] = await db()
      .select({ id: prospect.id })
      .from(prospect)
      .where(
        and(
          eq(prospect.programId, prog.id),
          sql`lower(${prospect.email}) = ${email}`,
          inArray(prospect.status, ["sent", "followed_up", "joined"]),
        ),
      );
    if (!pr) invited = false;
  }
  const risk = applicationRisk({ email, website: input.website });
  const decision = autoApproveDecision(prog, {
    email,
    website: input.website,
    country: input.country,
    riskScore: risk,
    invited,
  });
  const [group] = await db()
    .select()
    .from(partnerGroup)
    .where(and(eq(partnerGroup.programId, prog.id), eq(partnerGroup.isDefault, true)));
  const code = await uniqueCode(prog.id, input.name.split(/\s+/)[0] ?? email.split("@")[0]!);
  // two-tier: only an approved partner of this program can recruit, and never their own email
  let recruitedBy: string | null = null;
  if (input.recruiterCode) {
    const [rec] = await db()
      .select({ id: partner.id, email: partner.email })
      .from(partner)
      .where(
        and(
          eq(partner.programId, prog.id),
          sql`lower(${partner.code}) = lower(${input.recruiterCode})`,
          eq(partner.status, "approved"),
        ),
      );
    if (rec && rec.email !== email) recruitedBy = rec.id;
  }
  const [p] = await db()
    .insert(partner)
    .values({
      id: createId("prt"),
      programId: prog.id,
      workspaceId: prog.workspaceId,
      userId: input.userId ?? null,
      email,
      name: input.name.trim().slice(0, 120),
      website: input.website ?? null,
      country: input.country?.toUpperCase().slice(0, 2) ?? null,
      status: decision.approve ? "approved" : "pending",
      approvedAt: decision.approve ? new Date() : null,
      groupId: group?.id ?? null,
      code,
      answers: input.answers ?? {},
      source: input.source ?? (invited ? "invite" : "application"),
      riskScore: risk,
      signupIpHash: hashIp(input.ip),
      recruitedBy,
    })
    .returning();
  await db()
    .insert(link)
    .values({
      id: createId("lnk"),
      programId: prog.id,
      partnerId: p!.id,
      key: `${code}${createCode(2)}`,
      destination: prog.websiteUrl,
      label: "Default link",
    });
  await audit(
    prog.workspaceId,
    { type: "partner", id: p!.id },
    "partner.apply",
    { type: "partner", id: p!.id },
    { autoApproved: decision.approve, reason: decision.reason },
  );
  await enqueue("events.emit", {
    workspaceId: prog.workspaceId,
    event: decision.approve ? "partner.approved" : "partner.applied",
    data: { id: p!.id, name: p!.name, email: p!.email, recruitedBy: p!.recruitedBy },
  });
  if (decision.approve) await enqueue("notify.partner_approved", { partnerId: p!.id });
  else await enqueue("notify.new_application", { partnerId: p!.id });
  return { partner: p!, autoApproved: decision.approve, reason: decision.reason };
}

export async function setPartnerStatus(
  programId: string,
  ids: string[],
  status: Partner["status"],
  actor: Actor,
) {
  const rows = await db()
    .update(partner)
    .set({ status, ...(status === "approved" ? { approvedAt: new Date() } : {}) })
    .where(and(eq(partner.programId, programId), inArray(partner.id, ids)))
    .returning();
  if (status === "banned") {
    const held = await db()
      .update(commission)
      .set({ status: "held", heldReason: "Partner banned" })
      .where(
        and(
          eq(commission.programId, programId),
          inArray(commission.partnerId, ids),
          inArray(commission.status, ["pending", "approved"]),
        ),
      )
      .returning({ id: commission.id });
    await followOverrides(
      held.map((h) => h.id),
      "hold",
    );
  }
  for (const p of rows) {
    await audit(p.workspaceId, actor, `partner.${status}`, { type: "partner", id: p.id });
    if (status === "approved") {
      await enqueue("notify.partner_approved", { partnerId: p.id });
      await enqueue("events.emit", {
        workspaceId: p.workspaceId,
        event: "partner.approved",
        data: { id: p.id, name: p.name, email: p.email, recruitedBy: p.recruitedBy },
      });
    }
  }
  return rows;
}

export async function createLink(
  programId: string,
  partnerId: string,
  input: { destination: string; subId?: string | null; label?: string | null; key?: string | null },
) {
  const [prog] = await db().select().from(program).where(eq(program.id, programId));
  const [p] = await db()
    .select()
    .from(partner)
    .where(and(eq(partner.id, partnerId), eq(partner.programId, programId)));
  if (!prog || !p) throw new Error("Partner not found");
  const dest = new URL(input.destination);
  if (!/^https?:$/.test(dest.protocol)) throw new Error("Links must start with https://");
  const site = new URL(prog.websiteUrl);
  // deep links must stay on the founder's domain (or subdomains) so links can't be used as open redirects
  if (
    !(
      dest.hostname === site.hostname ||
      dest.hostname.endsWith(`.${site.hostname.replace(/^www\./, "")}`) ||
      dest.hostname === site.hostname.replace(/^www\./, "")
    )
  ) {
    throw new Error(`Links must point to ${site.hostname}`);
  }
  const key = input.key ? slugify(input.key).slice(0, 32) : `${p.code}${createCode(3)}`;
  const [l] = await db()
    .insert(link)
    .values({
      id: createId("lnk"),
      programId,
      partnerId,
      key,
      destination: dest.toString(),
      subId: input.subId ?? null,
      label: input.label ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!l) throw new Error(`The link key "${key}" is already taken in this program`);
  return l;
}

export async function createPromoCode(
  programId: string,
  partnerId: string,
  code: string,
  externalId?: string | null,
) {
  const [row] = await db()
    .insert(promoCode)
    .values({
      id: createId("prm"),
      programId,
      partnerId,
      code: code.toUpperCase(),
      externalId: externalId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

export async function sendMessage(
  prog: Program,
  input: {
    partnerId: string | null;
    subject?: string | null;
    body: string;
    fromPartner?: boolean;
    authorId?: string | null;
  },
) {
  if (input.partnerId) {
    const [own] = await db()
      .select({ id: partner.id })
      .from(partner)
      .where(and(eq(partner.id, input.partnerId), eq(partner.programId, prog.id)));
    if (!own) throw new Error("Partner not found");
  }
  const [m] = await db()
    .insert(message)
    .values({
      id: createId("msg"),
      programId: prog.id,
      partnerId: input.partnerId,
      fromPartner: input.fromPartner ?? false,
      authorId: input.authorId ?? null,
      subject: input.subject ?? null,
      body: input.body,
    })
    .returning();
  if (!input.fromPartner) {
    const targets = input.partnerId
      ? await db()
          .select({ email: partner.email })
          .from(partner)
          .where(and(eq(partner.id, input.partnerId), eq(partner.programId, prog.id)))
      : await db()
          .select({ email: partner.email })
          .from(partner)
          .where(and(eq(partner.programId, prog.id), eq(partner.status, "approved")))
          .limit(2000);
    for (const t of targets) {
      await enqueue("email.notice", {
        to: t.email,
        subject: input.subject ?? `A message from ${prog.name}`,
        title: input.subject ?? `A message from ${prog.name}`,
        paragraphs: [input.body],
        programId: prog.id,
        cta: { label: "Open partner portal", href: `${env.APP_URL}/p/${prog.slug}/portal/messages` },
      });
    }
  }
  return m!;
}

export async function partnerStats(partnerId: string) {
  const [row] = await db()
    .select({
      earned: sql<number>`coalesce(sum(${commission.amount}) filter (where ${commission.status} in ('approved','paid','pending')),0)::int`,
      paid: sql<number>`coalesce(sum(${commission.amount}) filter (where ${commission.status} = 'paid'),0)::int`,
    })
    .from(commission)
    .where(eq(commission.partnerId, partnerId));
  return { earned: row?.earned ?? 0, paid: row?.paid ?? 0 };
}

export { sendNotice };
