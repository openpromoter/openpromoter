import { program, programLogo } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { readLogo } from "@/lib/logo";
import { db } from "@/server/db";
import { env } from "@/server/env";

const logoBase = (programId: string) => `${env.APP_URL}/api/logo/${programId}`;

/** Stores an uploaded logo and points the program's brand at it. A new upload gets a new URL (?v=). */
export async function saveProgramLogo(
  programId: string,
  bytes: Buffer,
): Promise<{ url: string } | { error: string }> {
  const r = readLogo(bytes);
  if ("error" in r) return r;
  const url = `${logoBase(programId)}?v=${Date.now().toString(36)}`;
  await db().transaction(async (tx) => {
    await tx
      .insert(programLogo)
      .values({ programId, data: bytes, type: r.type })
      .onConflictDoUpdate({
        target: programLogo.programId,
        set: { data: bytes, type: r.type, updatedAt: new Date() },
      });
    const [p] = await tx.select({ brand: program.brand }).from(program).where(eq(program.id, programId));
    if (!p) throw new Error("Program not found");
    await tx
      .update(program)
      .set({ brand: { ...p.brand, logoUrl: url } })
      .where(eq(program.id, programId));
  });
  return { url };
}

/** Deletes the uploaded logo. The brand's logo link is cleared only if it still points at the upload. */
export async function removeProgramLogo(programId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(programLogo).where(eq(programLogo.programId, programId));
    const [p] = await tx.select({ brand: program.brand }).from(program).where(eq(program.id, programId));
    if (p?.brand.logoUrl?.startsWith(logoBase(programId)))
      await tx
        .update(program)
        .set({ brand: { ...p.brand, logoUrl: null } })
        .where(eq(program.id, programId));
  });
}
