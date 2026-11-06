import {
  type NoticeProps,
  noticeText,
  type ReportProps,
  renderNotice,
  renderReport,
  reportText,
} from "@openpromoter/emails";
import nodemailer from "nodemailer";
import { env } from "./env";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

/** Sends through Resend when RESEND_API_KEY is set, SMTP when SMTP_URL is set, else logs (dev). */
export async function sendMail(mail: Mail): Promise<{ delivered: boolean }> {
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
    return { delivered: true };
  }
  if (env.SMTP_URL) {
    transport ??= nodemailer.createTransport(env.SMTP_URL);
    await transport.sendMail({ from: env.EMAIL_FROM, ...mail });
    return { delivered: true };
  }
  // ponytail: no mail transport configured, log the subject only (never the body, it may hold tokens)
  console.info(`[email] not sent (no SMTP_URL or RESEND_API_KEY): "${mail.subject}"`);
  return { delivered: false };
}

export async function sendNotice(to: string, subject: string, props: NoticeProps, replyTo?: string) {
  return sendMail({
    to,
    subject,
    html: await renderNotice(props),
    text: noticeText(props),
    replyTo,
  });
}

export async function sendReport(to: string, subject: string, props: ReportProps) {
  return sendMail({ to, subject, html: await renderReport(props), text: reportText(props) });
}
