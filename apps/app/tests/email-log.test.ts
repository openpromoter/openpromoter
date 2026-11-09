import { createSign, generateKeyPairSync } from "node:crypto";
import { emailLog } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sendMail } from "@/server/email";
import { applySesNotice, type SnsMessage, signedString, verifySns } from "@/server/ses-events";

const { db } = await import("@/server/db");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const sign = (m: Omit<SnsMessage, "Signature">): SnsMessage => {
  const s = createSign("RSA-SHA256");
  s.update(signedString(m as SnsMessage));
  return { ...m, Signature: s.sign(privateKey, "base64") };
};
const note = (over: Partial<SnsMessage> = {}) =>
  sign({
    Type: "Notification",
    MessageId: "m1",
    TopicArn: "arn:aws:sns:us-east-1:1:openpromoter-ses",
    Message: "{}",
    Timestamp: "2026-11-09T00:00:00Z",
    SignatureVersion: "2",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
    ...over,
  });

describe("email log", () => {
  it("records every email without its body, even when no transport is set", async () => {
    await sendMail({
      to: "Log.Test@Example.test",
      subject: "Reset your password",
      html: "<b>secret link</b>",
    });
    const [row] = await db().select().from(emailLog).where(eq(emailLog.to, "log.test@example.test"));
    expect(row!.subject).toBe("Reset your password");
    expect(row!.status).toBe("not_sent");
    expect(JSON.stringify(row)).not.toContain("secret link");
  });

  it("accepts only SNS messages Amazon signed, from an Amazon host", async () => {
    const fetchCert = async () => pem;
    expect(await verifySns(note(), fetchCert)).toBe(true);
    expect(await verifySns({ ...note(), Message: '{"tampered":1}' }, fetchCert)).toBe(false);
    expect(await verifySns(note({ SigningCertURL: "https://evil.example/cert.pem" }), fetchCert)).toBe(false);
    expect(
      await verifySns(note({ SigningCertURL: "http://sns.us-east-1.amazonaws.com/c.pem" }), fetchCert),
    ).toBe(false);
  });

  it("marks delivered, then bounced, and a late delivery never hides a bounce", async () => {
    await db()
      .insert(emailLog)
      .values({ id: "eml_t1", to: "x@example.test", subject: "Hi", messageId: "ses-1", status: "sent" });
    const status = async () => (await db().select().from(emailLog).where(eq(emailLog.id, "eml_t1")))[0]!;
    await applySesNotice(JSON.stringify({ notificationType: "Delivery", mail: { messageId: "ses-1" } }));
    expect((await status()).status).toBe("delivered");
    await db().update(emailLog).set({ status: "sent" }).where(eq(emailLog.id, "eml_t1"));
    await applySesNotice(
      JSON.stringify({
        notificationType: "Bounce",
        mail: { messageId: "ses-1" },
        bounce: {
          bounceType: "Permanent",
          bounceSubType: "General",
          bouncedRecipients: [{ diagnosticCode: "550 no such user" }],
        },
      }),
    );
    expect(await status()).toMatchObject({
      status: "bounced",
      detail: "Permanent General: 550 no such user",
    });
    await applySesNotice(JSON.stringify({ notificationType: "Delivery", mail: { messageId: "ses-1" } }));
    expect((await status()).status).toBe("bounced");
  });
});
