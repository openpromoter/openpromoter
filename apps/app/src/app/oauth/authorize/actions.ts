"use server";

import { redirect } from "next/navigation";
import { requireWorkspace } from "@/server/access";
import { currentUser } from "@/server/context";
import { appUrl, callbackUrl, issueCode, readClient } from "@/server/oauth";
import { assertFounderVerified } from "@/server/partners";

/** Consent screen submit. `q` is the original /oauth/authorize query; everything is checked again here. */
export async function authorizeAction(f: FormData) {
  const q = new URLSearchParams(String(f.get("q") ?? ""));
  const u = await currentUser();
  if (!u) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${q}`)}`);
  const clientId = q.get("client_id");
  const redirectUri = q.get("redirect_uri") ?? "";
  const challenge = q.get("code_challenge");
  const client = readClient(clientId);
  if (!client?.redirectUris.includes(redirectUri) || !challenge) throw new Error("Unknown app");
  const state = q.get("state");
  if (f.get("decision") !== "allow") redirect(callbackUrl(redirectUri, { error: "access_denied", state }));

  const access = f.get("access") === "write" ? "write" : "read";
  const workspaceId = String(f.get("workspace") ?? "");
  // an error code, not a message: the page maps it to fixed text, so a crafted link can't put words there
  let problem: "workspace" | "verify" | null = null;
  try {
    await requireWorkspace(u.id, workspaceId, "developer.write");
  } catch {
    problem = "workspace";
  }
  // write access can invite partners, and each invite is an email from our sender
  if (!problem && access === "write") {
    try {
      await assertFounderVerified(u);
    } catch {
      problem = "verify";
    }
  }
  if (problem) {
    q.set("op_error", problem);
    redirect(`/oauth/authorize?${q}`);
  }
  const code = await issueCode({
    clientId: clientId!,
    redirectUri,
    challenge,
    workspaceId,
    userId: u.id,
    access,
  });
  redirect(callbackUrl(redirectUri, { code, state, iss: appUrl() }));
}
