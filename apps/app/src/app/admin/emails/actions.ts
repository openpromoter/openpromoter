"use server";

import { emailLog } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PRODUCT } from "@/lib/config";
import { requireAdmin } from "@/server/admin";
import { safe } from "@/server/context";
import { db } from "@/server/db";
import { sendNotice } from "@/server/email";

/**
 * One test email through the real sending path, so the owner can watch it arrive in the log and turn
 * Delivered (or Bounced) once Amazon SES reports back. Admins only.
 */
export async function sendTestEmailAction(to: string) {
  return safe(async () => {
    await requireAdmin();
    const email = z.email().parse(to.trim());
    const r = await sendNotice(email, `${PRODUCT.name} test email`, {
      brandName: PRODUCT.name,
      preview: "A test from the admin console",
      title: "This is a test email",
      paragraphs: ["It was sent from the OpenPromoter admin console to check that email is working."],
    });
    revalidatePath("/admin/emails");
    if (!r.delivered)
      throw new Error("Not sent: this address can't receive email, or no mail service is set up");
    return true;
  }, "Sent. Its status updates when the mail service reports back.");
}

/** The link-free copy of one email for the admin's preview. Null for emails sent before copies were kept. */
export async function emailPreviewAction(id: string): Promise<string | null> {
  await requireAdmin();
  const [row] = await db().select({ preview: emailLog.preview }).from(emailLog).where(eq(emailLog.id, id));
  return row?.preview ?? null;
}
