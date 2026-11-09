import { env } from "@/server/env";
import { applySesNotice, type SnsMessage, snsHost, verifySns } from "@/server/ses-events";

/** Amazon SES notices via SNS (see ses-events.ts). Off until SES_SNS_TOPIC_ARN is set. */
export async function POST(req: Request) {
  if (!env.SES_SNS_TOPIC_ARN) return new Response("Not configured", { status: 404 });
  const m = (await req.json().catch(() => null)) as SnsMessage | null;
  if (!m || m.TopicArn !== env.SES_SNS_TOPIC_ARN || !(await verifySns(m).catch(() => false)))
    return new Response("Bad signature", { status: 403 });
  if (m.Type === "SubscriptionConfirmation" && m.SubscribeURL && snsHost(m.SubscribeURL)) {
    await fetch(m.SubscribeURL);
    return new Response("Subscribed");
  }
  if (m.Type === "Notification") await applySesNotice(m.Message);
  return new Response("ok");
}
