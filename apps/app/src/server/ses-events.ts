import { createVerify } from "node:crypto";
import { emailLog } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { db } from "./db";

/**
 * Amazon SES delivery, bounce and complaint notices, delivered by SNS. Only messages Amazon signed (the
 * certificate must come from an sns.<region>.amazonaws.com host) and only from SES_SNS_TOPIC_ARN count.
 */
export interface SnsMessage {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

const certs = new Map<string, string>();
export const snsHost = (u: string) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(url.hostname);
  } catch {
    return false;
  }
};

/** The exact string SNS signs (docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html). */
export function signedString(m: SnsMessage) {
  const keys =
    m.Type === "Notification"
      ? ["Message", "MessageId", ...(m.Subject ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys.map((k) => `${k}\n${m[k as keyof SnsMessage]}\n`).join("");
}

export async function verifySns(m: SnsMessage, fetchCert = (u: string) => fetch(u).then((r) => r.text())) {
  if (!snsHost(m.SigningCertURL) || !["1", "2"].includes(m.SignatureVersion)) return false;
  let pem = certs.get(m.SigningCertURL);
  if (!pem) {
    pem = await fetchCert(m.SigningCertURL);
    if (certs.size > 20) certs.clear();
    certs.set(m.SigningCertURL, pem);
  }
  const v = createVerify(m.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
  v.update(signedString(m));
  return v.verify(pem, m.Signature, "base64");
}

type SesNotice = {
  notificationType?: "Bounce" | "Complaint" | "Delivery";
  eventType?: "Bounce" | "Complaint" | "Delivery";
  mail: { messageId: string };
  bounce?: { bounceType: string; bounceSubType: string; bouncedRecipients?: { diagnosticCode?: string }[] };
  complaint?: { complaintFeedbackType?: string };
};

/** Applies one SES notice to the email log. A delivery never overwrites a bounce or complaint. */
export async function applySesNotice(raw: string) {
  const n = JSON.parse(raw) as SesNotice;
  const kind = n.notificationType ?? n.eventType;
  const id = n.mail?.messageId;
  if (!id || !kind) return;
  const [row] = await db().select().from(emailLog).where(eq(emailLog.messageId, id));
  if (!row) return;
  if (kind === "Delivery" && row.status !== "sent") return;
  const status = kind === "Bounce" ? "bounced" : kind === "Complaint" ? "complained" : "delivered";
  const detail =
    kind === "Bounce"
      ? `${n.bounce?.bounceType} ${n.bounce?.bounceSubType}: ${n.bounce?.bouncedRecipients?.[0]?.diagnosticCode ?? ""}`.trim()
      : kind === "Complaint"
        ? `Marked as spam${n.complaint?.complaintFeedbackType ? ` (${n.complaint.complaintFeedbackType})` : ""}`
        : null;
  await db()
    .update(emailLog)
    .set({ status, detail: detail?.slice(0, 500) ?? row.detail, updatedAt: new Date() })
    .where(eq(emailLog.id, row.id));
}
