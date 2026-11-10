import { emailLog, member, user } from "@openpromoter/db";
import {
  type NoticeProps,
  noticeText,
  type ReportProps,
  renderNotice,
  renderReport,
  reportText,
} from "@openpromoter/emails";
import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { createId } from "@/lib/id";
import { db } from "./db";
import { env } from "./env";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** The program the email is about, for the admin's email log. */
  programId?: string | null;
  /** Shown as the sender ("Acme Analytics"); the address stays EMAIL_FROM's, so SPF, DKIM and DMARC still align. */
  fromName?: string;
  /** One-click unsubscribe link for optional emails (List-Unsubscribe, RFC 8058). */
  unsubscribe?: string;
}

/** EMAIL_FROM is "Name <address>" or a bare address. */
const fromAddress = () => /<([^>]+)>/.exec(env.EMAIL_FROM)?.[1] ?? env.EMAIL_FROM.trim();

/** A program name made safe for the From header: no line breaks, quotes or angle brackets. */
export const senderName = (name: string) =>
  name
    .replace(/[\r\n"<>\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "OpenPromoter";

/** The envelope every transport sends: who it is from, where replies go, and the unsubscribe headers. */
export function envelope(mail: Mail) {
  return {
    from: mail.fromName ? `"${senderName(mail.fromName)}" <${fromAddress()}>` : env.EMAIL_FROM,
    replyTo: mail.replyTo,
    headers: mail.unsubscribe
      ? { "List-Unsubscribe": `<${mail.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      : undefined,
  };
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

/** One line in the email log (never the body). A failed write never stops the email itself. */
async function logEmail(
  mail: Mail,
  status: "sent" | "failed" | "not_sent",
  messageId?: string | null,
  detail?: string,
) {
  await db()
    .insert(emailLog)
    .values({
      id: createId("eml"),
      to: mail.to.toLowerCase(),
      subject: mail.subject.slice(0, 300),
      programId: mail.programId ?? null,
      messageId: messageId ?? null,
      status,
      detail: detail?.slice(0, 500) ?? null,
    })
    .catch((e) => console.error(`[email] log failed: ${(e as Error).message}`));
}

/** Sends and records it in the email log. */
export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
  // reserved names (RFC 2606/6761) never receive mail: sending would only bounce and hurt our sender score.
  // The demo and seed data live there. Production only: local test runs read these from Mailpit.
  if (process.env.NODE_ENV === "production" && /\.(test|example|invalid|localhost)$/i.test(mail.to.trim())) {
    await logEmail(mail, "not_sent", null, "Reserved address, never delivered");
    return { delivered: false };
  }
  try {
    const r = await deliver(mail);
    await logEmail(mail, r.delivered ? "sent" : "not_sent", r.messageId);
    return { delivered: r.delivered };
  } catch (e) {
    await logEmail(mail, "failed", null, (e as Error).message);
    throw e;
  }
}

/** Sends through Resend when RESEND_API_KEY is set, SMTP when SMTP_URL is set, else logs (dev). */
async function deliver(mail: Mail): Promise<{ delivered: boolean; messageId?: string | null }> {
  const { from, replyTo, headers } = envelope(mail);
  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        reply_to: replyTo,
        headers,
      }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}`);
    return { delivered: true, messageId: ((await res.json().catch(() => ({}))) as { id?: string }).id };
  }
  if (env.SMTP_URL) {
    transport ??= nodemailer.createTransport(env.SMTP_URL);
    const info = await transport.sendMail({
      from,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      replyTo,
      headers,
    });
    // Amazon SES answers "250 Ok <message id>"; its delivery and bounce notices carry the same id
    return { delivered: true, messageId: /^250 Ok (\S+)/.exec(info.response ?? "")?.[1] ?? info.messageId };
  }
  // ponytail: no mail transport configured, log the subject only (never the body, it may hold tokens)
  console.info(`[email] not sent (no SMTP_URL or RESEND_API_KEY): "${mail.subject}"`);
  return { delivered: false };
}

export interface SendOpts {
  replyTo?: string;
  programId?: string | null;
  fromName?: string;
  unsubscribe?: string;
}

export async function sendNotice(to: string, subject: string, props: NoticeProps, opts: SendOpts = {}) {
  const p = { ...props, unsubscribeUrl: opts.unsubscribe };
  return sendMail({ to, subject, html: await renderNotice(p), text: noticeText(p), ...opts });
}

export async function sendReport(to: string, subject: string, props: ReportProps, opts: SendOpts = {}) {
  const p = { ...props, unsubscribeUrl: opts.unsubscribe };
  return sendMail({ to, subject, html: await renderReport(p), text: reportText(p), ...opts });
}

/**
 * Emails a program sends its partners: the program's name as the sender and replies to the founder
 * (the program's reply-to, else the workspace owner), never to OpenPromoter.
 */
export async function programSender(prog: {
  id: string;
  name: string;
  workspaceId: string;
  replyTo: string | null;
}) {
  let replyTo = prog.replyTo ?? undefined;
  if (!replyTo) {
    const [o] = await db()
      .select({ email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.workspaceId, prog.workspaceId), eq(member.role, "owner")))
      .limit(1);
    replyTo = o?.email;
  }
  return { fromName: prog.name, replyTo, programId: prog.id };
}
