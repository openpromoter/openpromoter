import { emailLog } from "@openpromoter/db";
import {
  type NoticeProps,
  noticeText,
  type ReportProps,
  renderNotice,
  renderReport,
  reportText,
} from "@openpromoter/emails";
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
async function deliver({
  programId: _,
  ...mail
}: Mail): Promise<{ delivered: boolean; messageId?: string | null }> {
  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        reply_to: mail.replyTo,
      }),
    });
    if (!res.ok) throw new Error(`Resend error ${res.status}`);
    return { delivered: true, messageId: ((await res.json().catch(() => ({}))) as { id?: string }).id };
  }
  if (env.SMTP_URL) {
    transport ??= nodemailer.createTransport(env.SMTP_URL);
    const info = await transport.sendMail({ from: env.EMAIL_FROM, ...mail });
    // Amazon SES answers "250 Ok <message id>"; its delivery and bounce notices carry the same id
    return { delivered: true, messageId: /^250 Ok (\S+)/.exec(info.response ?? "")?.[1] ?? info.messageId };
  }
  // ponytail: no mail transport configured, log the subject only (never the body, it may hold tokens)
  console.info(`[email] not sent (no SMTP_URL or RESEND_API_KEY): "${mail.subject}"`);
  return { delivered: false };
}

export async function sendNotice(
  to: string,
  subject: string,
  props: NoticeProps,
  replyTo?: string,
  programId?: string | null,
) {
  return sendMail({
    to,
    subject,
    html: await renderNotice(props),
    text: noticeText(props),
    replyTo,
    programId,
  });
}

export async function sendReport(to: string, subject: string, props: ReportProps) {
  return sendMail({ to, subject, html: await renderReport(props), text: reportText(props) });
}
