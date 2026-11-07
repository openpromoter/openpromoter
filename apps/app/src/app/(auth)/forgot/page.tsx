import type { Metadata } from "next";
import { headers } from "next/headers";
import { captchaFor } from "@/server/captcha";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPage() {
  return <ForgotForm captcha={captchaFor(await headers())} />;
}
