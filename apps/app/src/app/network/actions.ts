"use server";

import { headers } from "next/headers";
import { currentUser, safe } from "@/server/context";
import { joinFromMarketplace } from "@/server/marketplace";
import { clientIp, limit } from "@/server/ratelimit";

export async function joinAction(slug: string) {
  return safe(async () => {
    const u = await currentUser();
    if (!u) throw new Error("Sign in to apply");
    const ip = clientIp({ headers: await headers() }) ?? "unknown";
    if (!(await limit(`apply:${ip}`, 10, 3_600_000)).ok)
      throw new Error("Too many applications from this network. Try again later.");
    const r = await joinFromMarketplace(u, slug, ip);
    return { approved: r.autoApproved };
  });
}
