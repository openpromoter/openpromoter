import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { OpenPromoter, OpenPromoterError } from "openpromoter";

declare const __SKILL__: string;

const CONFIG = path.join(homedir(), ".config", "openpromoter", "config.json");

function config(): { url: string; key: string } {
  const url = process.env.OPENPROMOTER_URL;
  const key = process.env.OPENPROMOTER_API_KEY;
  if (url && key) return { url, key };
  if (!existsSync(CONFIG))
    throw new Error("Not logged in. Run: openpromoter login --url <url> --key <api key>");
  return JSON.parse(readFileSync(CONFIG, "utf8"));
}

const client = () => {
  const c = config();
  return new OpenPromoter({ apiKey: c.key, baseUrl: c.url });
};

const money = (n: number, c = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: c.toUpperCase() }).format(n / 100);

async function run(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(
      err instanceof OpenPromoterError
        ? `Error ${err.status} ${err.code}: ${err.message}`
        : `Error: ${(err as Error).message}`,
    );
    process.exit(1);
  }
}

const out = (v: unknown, json?: boolean) => console.log(json ? JSON.stringify(v, null, 2) : v);

const program = new Command().name("openpromoter").description("OpenPromoter command line").version("0.1.0");

program
  .command("login")
  .description("Save your OpenPromoter URL and API key")
  .requiredOption("--key <key>", "API key (Settings → API & webhooks)")
  .option("--url <url>", "OpenPromoter URL", "https://app.openpromoter.com")
  .action((o) =>
    run(async () => {
      const op = new OpenPromoter({ apiKey: o.key, baseUrl: o.url });
      const { data } = await op.programs.list();
      mkdirSync(path.dirname(CONFIG), { recursive: true });
      writeFileSync(CONFIG, JSON.stringify({ url: o.url, key: o.key }, null, 2));
      chmodSync(CONFIG, 0o600);
      console.log(
        `Logged in. ${data.length} program(s): ${data.map((p) => `${p.name} (${p.id})`).join(", ")}`,
      );
    }),
  );

program
  .command("programs")
  .option("--json")
  .action((o) =>
    run(async () => {
      const { data } = await client().programs.list();
      o.json
        ? out(data, true)
        : console.table(data.map((p) => ({ id: p.id, name: p.name, slug: p.slug, currency: p.currency })));
    }),
  );

program
  .command("stats")
  .requiredOption("--program <id>")
  .option("--days <n>", "look-back days", "30")
  .option("--json")
  .action((o) =>
    run(async () => {
      const s = await client().programs.stats(o.program, { days: Number(o.days) });
      o.json
        ? out(s, true)
        : console.table({
            revenue: money(s.revenue ?? 0),
            commissions: money(s.commissions ?? 0),
            clicks: s.clicks,
            signups: s.leads,
            customers: s.customers,
            mrr: money(s.mrr ?? 0),
            owed: money(s.owed ?? 0),
          });
    }),
  );

const partners = program.command("partners").description("Manage partners");
partners
  .command("list")
  .requiredOption("--program <id>")
  .option("--status <status>")
  .option("--json")
  .action((o) =>
    run(async () => {
      const { data } = await client().partners.list(o.program, { status: o.status, limit: 100 });
      o.json
        ? out(data, true)
        : console.table(
            data.map((p) => ({ id: p.id, name: p.name, email: p.email, status: p.status, code: p.code })),
          );
    }),
  );
partners
  .command("invite")
  .requiredOption("--program <id>")
  .requiredOption("--email <email>")
  .requiredOption("--name <name>")
  .action((o) =>
    run(async () => {
      const p = await client().partners.create(o.program, { email: o.email, name: o.name });
      console.log(`Invited ${p.name} (${p.id}), code ${p.code}`);
    }),
  );
for (const [cmd, status] of [
  ["approve", "approved"],
  ["pause", "paused"],
  ["ban", "banned"],
] as const) {
  partners.command(`${cmd} <partnerId>`).action((id: string) =>
    run(async () => {
      const p = await client().partners.update(id, { status });
      console.log(`${p.name} is now ${p.status}`);
    }),
  );
}

program
  .command("commissions")
  .requiredOption("--program <id>")
  .option("--status <status>")
  .option("--json")
  .action((o) =>
    run(async () => {
      const { data } = await client().commissions.list(o.program, { status: o.status, limit: 100 });
      o.json
        ? out(data, true)
        : console.table(
            data.map((c) => ({
              id: c.id,
              partner: c.partnerId,
              status: c.status,
              amount: money(c.amount, c.currency),
              created: c.createdAt.slice(0, 10),
            })),
          );
    }),
  );

const payouts = program
  .command("payouts")
  .description("List or prepare payouts (approval happens in the dashboard)");
payouts
  .command("list")
  .requiredOption("--program <id>")
  .option("--json")
  .action((o) =>
    run(async () => {
      const { data } = await client().payouts.list(o.program);
      o.json
        ? out(data, true)
        : console.table(
            data.map((p) => ({
              id: p.id,
              partner: p.partnerId,
              amount: money(p.amount, p.currency),
              method: p.method,
              status: p.status,
            })),
          );
    }),
  );
payouts
  .command("prepare")
  .requiredOption("--program <id>")
  .action((o) =>
    run(async () => {
      const r = await client().payouts.prepare(o.program);
      console.log(
        `${r.data.length} payout(s) prepared. Approve them in the dashboard: ${config().url}/app/${o.program}/payouts`,
      );
    }),
  );

program
  .command("ask <question...>")
  .requiredOption("--program <id>")
  .action((q: string[], o) =>
    run(async () => {
      const a = await client().ask(o.program, q.join(" "));
      console.log(a.text);
    }),
  );

program
  .command("listen")
  .description("Forward live OpenPromoter events to a local URL, signed like real webhooks")
  .requiredOption("--forward-to <url>", "e.g. http://localhost:4000/webhooks/openpromoter")
  .option("--secret <secret>", "signing secret for the forwarded requests", "whsec_local_listen")
  .action((o) =>
    run(async () => {
      const { createHmac } = await import("node:crypto");
      const op = client();
      // start from now: only new events are forwarded
      let after = `evt_${Date.now().toString(36).padStart(9, "0")}`;
      console.log(`Forwarding events to ${o.forwardTo} (secret ${o.secret}). Ctrl+C to stop.`);
      for (;;) {
        const { data } = await op.events.list({ after, limit: 100 });
        for (const e of data) {
          const body = JSON.stringify(e);
          const t = Math.floor(Date.now() / 1000);
          const sig = `t=${t},v1=${createHmac("sha256", o.secret).update(`${t}.${body}`).digest("hex")}`;
          const res = await fetch(o.forwardTo, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "OpenPromoter-Signature": sig,
              "OpenPromoter-Event": e.type,
            },
            body,
          }).catch((err: Error) => ({ status: err.message }));
          console.log(`${new Date().toISOString()}  ${e.type}  → ${"status" in res ? res.status : ""}`);
          after = e.id;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }),
  );

program
  .command("skill")
  .description(
    "Install the 'add OpenPromoter' agent skill for Claude Code, Codex, Cursor and other coding agents in this project",
  )
  .option("--dir <dir>", "project directory", ".")
  .action((o) =>
    run(async () => {
      const claude = path.join(o.dir, ".claude", "skills", "openpromoter", "SKILL.md");
      const cursor = path.join(o.dir, ".cursor", "rules", "openpromoter.mdc");
      // Codex and other agents that follow the open Agent Skills layout
      const agents = path.join(o.dir, ".agents", "skills", "openpromoter", "SKILL.md");
      for (const f of [claude, agents, cursor]) {
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(
          f,
          f.endsWith(".mdc")
            ? __SKILL__.replace(
                /^---[\s\S]*?---/,
                "---\ndescription: Add an OpenPromoter affiliate program to this app\nalwaysApply: false\n---",
              )
            : __SKILL__,
        );
        console.log(`wrote ${f}`);
      }
      console.log('Now ask your agent: "add an affiliate program to my app with OpenPromoter"');
    }),
  );

program.parseAsync();
