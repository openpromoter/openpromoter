import { programLogo, program as programTable } from "@openpromoter/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/logo/[programId]/route";
import { LOGO_MAX_BYTES, readLogo } from "@/lib/logo";
import { db } from "@/server/db";
import { removeProgramLogo, saveProgramLogo } from "@/server/program-logo";
import { fixture } from "./helpers";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

describe("readLogo", () => {
  it("knows PNG, JPEG and WebP from their first bytes", () => {
    expect(readLogo(png)).toEqual({ type: "image/png" });
    expect(readLogo(jpeg)).toEqual({ type: "image/jpeg" });
    expect(readLogo(webp)).toEqual({ type: "image/webp" });
  });

  it("refuses SVG, GIF and anything else, whatever the file claims to be", () => {
    expect(readLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toHaveProperty(
      "error",
    );
    expect(readLogo(Buffer.from("GIF89a"))).toHaveProperty("error");
    expect(readLogo(Buffer.alloc(0))).toHaveProperty("error");
  });

  it("refuses a file over the size limit", () => {
    const big = Buffer.concat([png, Buffer.alloc(LOGO_MAX_BYTES)]);
    expect(readLogo(big)).toEqual({ error: "Logos can be up to 1 MB" });
  });
});

describe("GET /api/logo/[programId]", () => {
  const get = (programId: string) =>
    GET(new Request(`http://test/api/logo/${programId}`), { params: Promise.resolve({ programId }) });

  it("serves an uploaded logo with its type and no sniffing", async () => {
    const { program } = await fixture();
    await db().insert(programLogo).values({ programId: program.id, data: png, type: "image/png" });
    const res = await get(program.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
  });

  it("answers 404 for a program without an uploaded logo", async () => {
    const { program } = await fixture();
    expect((await get(program.id)).status).toBe(404);
    expect((await get("prg_missing")).status).toBe(404);
  });
});

describe("saveProgramLogo and removeProgramLogo", () => {
  const brandOf = async (id: string) =>
    (await db().select().from(programTable).where(eq(programTable.id, id)))[0]!.brand;
  const stored = async (id: string) => db().select().from(programLogo).where(eq(programLogo.programId, id));

  it("stores the logo, points the brand at it and keeps the colour", async () => {
    const { program } = await fixture();
    const r = await saveProgramLogo(program.id, png);
    expect(r).toHaveProperty("url");
    const url = (r as { url: string }).url;
    expect(url).toMatch(new RegExp(`^http://localhost:3000/api/logo/${program.id}\\?v=`));
    expect((await brandOf(program.id)).logoUrl).toBe(url);
    expect((await brandOf(program.id)).color).toBe("#0B7A60");
    expect((await stored(program.id))[0]!.type).toBe("image/png");
  });

  it("replaces an earlier upload with a new link", async () => {
    const { program } = await fixture();
    const first = (await saveProgramLogo(program.id, png)) as { url: string };
    await new Promise((r) => setTimeout(r, 5));
    const second = (await saveProgramLogo(program.id, jpeg)) as { url: string };
    expect(second.url).not.toBe(first.url);
    const rows = await stored(program.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("image/jpeg");
  });

  it("refuses an SVG and changes nothing", async () => {
    const { program } = await fixture({ brand: { color: "#0B7A60", logoUrl: "https://acme.test/logo.png" } });
    expect(await saveProgramLogo(program.id, Buffer.from("<svg/>"))).toHaveProperty("error");
    expect((await brandOf(program.id)).logoUrl).toBe("https://acme.test/logo.png");
    expect(await stored(program.id)).toHaveLength(0);
  });

  it("removes the upload and clears the link that pointed at it", async () => {
    const { program } = await fixture();
    await saveProgramLogo(program.id, png);
    await removeProgramLogo(program.id);
    expect(await stored(program.id)).toHaveLength(0);
    expect((await brandOf(program.id)).logoUrl).toBeNull();
  });

  it("keeps a pasted logo link when removing", async () => {
    const { program } = await fixture({ brand: { color: "#0B7A60", logoUrl: "https://acme.test/logo.png" } });
    await removeProgramLogo(program.id);
    expect((await brandOf(program.id)).logoUrl).toBe("https://acme.test/logo.png");
  });
});
