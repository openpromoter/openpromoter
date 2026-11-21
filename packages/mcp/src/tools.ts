import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type OpenPromoter, OpenPromoterError } from "openpromoter";
import { z } from "zod";

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: z.ZodRawShape;
  write: boolean;
  /** Set only on write tools. Read tools are always read-only, closed-world, idempotent. */
  hints?: { destructive: boolean; openWorld: boolean; idempotent: boolean };
  run: (op: OpenPromoter, args: Record<string, any>) => Promise<unknown>;
}

const program = { programId: z.string().describe("Program id (prg_...). Use list_programs to find it.") };

/** Read tools are always on. Write tools need OPENPROMOTER_MCP_WRITE=true. No tool can send money. */
export const TOOLS: ToolDef[] = [
  {
    name: "list_programs",
    title: "List programs",
    description: "List affiliate programs in the workspace.",
    input: {},
    write: false,
    run: (op) => op.programs.list(),
  },
  {
    name: "program_stats",
    title: "Program stats",
    description:
      "Revenue, commissions, clicks, signups, customers, conversion, EPC, MRR and amounts owed for the last N days.",
    input: { ...program, days: z.number().int().min(1).max(730).default(30) },
    write: false,
    run: (op, a) => op.programs.stats(a.programId, { days: a.days }),
  },
  {
    name: "list_partners",
    title: "List partners",
    description: "List partners, newest first.",
    input: {
      ...program,
      status: z.enum(["pending", "approved", "rejected", "paused", "banned"]).optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    write: false,
    run: (op, a) => op.partners.list(a.programId, { status: a.status, limit: a.limit }),
  },
  {
    name: "get_partner",
    title: "Get partner",
    description: "Get one partner with their links.",
    input: { partnerId: z.string() },
    write: false,
    run: (op, a) => op.partners.get(a.partnerId),
  },
  {
    name: "list_commissions",
    title: "List commissions",
    description: "List commissions (pending, approved, held, paid, reversed).",
    input: {
      ...program,
      status: z.enum(["pending", "approved", "held", "paid", "reversed"]).optional(),
      partnerId: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
    write: false,
    run: (op, a) =>
      op.commissions.list(a.programId, { status: a.status, partnerId: a.partnerId, limit: a.limit }),
  },
  {
    name: "list_payouts",
    title: "List payouts",
    description: "List payouts and their status.",
    input: {
      ...program,
      status: z.enum(["awaiting_approval", "processing", "paid", "failed", "canceled"]).optional(),
    },
    write: false,
    run: (op, a) => op.payouts.list(a.programId, { status: a.status }),
  },
  {
    name: "autopilot_suggestions",
    title: "Autopilot suggestions",
    description: "Autopilot's current suggestions and recent actions.",
    input: program,
    write: false,
    run: (op, a) => op.autopilot.list(a.programId),
  },
  {
    name: "ask",
    title: "Ask about the program",
    description:
      "Ask a plain-language question about the program, answered from its data (e.g. 'which partners brought paying customers last month?').",
    input: { ...program, question: z.string().min(2).max(500) },
    write: false,
    run: (op, a) => op.ask(a.programId, a.question),
  },
  {
    name: "invite_partner",
    title: "Invite partner",
    description: "Invite and approve a partner by email. They get an email with their link.",
    input: { ...program, email: z.email(), name: z.string() },
    write: true,
    hints: { destructive: false, openWorld: true, idempotent: false },
    run: (op, a) => op.partners.create(a.programId, { email: a.email, name: a.name }),
  },
  {
    name: "set_partner_status",
    title: "Set partner status",
    description:
      "Approve, pause, reject or ban a partner. Rejecting or banning stops the partner earning, so confirm with the user first.",
    input: { partnerId: z.string(), status: z.enum(["approved", "paused", "rejected", "banned"]) },
    write: true,
    hints: { destructive: true, openWorld: false, idempotent: true },
    run: (op, a) => op.partners.update(a.partnerId, { status: a.status }),
  },
  {
    name: "draft_campaign",
    title: "Draft campaign",
    description:
      "Create a DRAFT campaign from one sentence (e.g. 'double commissions for annual plans this month'). A person launches it in the dashboard.",
    input: { ...program, prompt: z.string().min(3).max(300) },
    write: true,
    hints: { destructive: false, openWorld: false, idempotent: false },
    run: (op, a) => op.campaigns.create(a.programId, { prompt: a.prompt, launch: false }),
  },
  {
    name: "prepare_payouts",
    title: "Prepare payouts",
    description:
      "Prepare payouts for partners over the minimum. This NEVER sends money: the batch waits until a person approves it in the OpenPromoter dashboard (Payouts page). Tell the user to review and approve it there.",
    input: { ...program, partnerIds: z.array(z.string()).optional() },
    write: true,
    hints: { destructive: false, openWorld: false, idempotent: false },
    run: (op, a) => op.payouts.prepare(a.programId, { partnerIds: a.partnerIds }),
  },
];

/** Registers the tools on a server. Shared by the stdio CLI and the app's remote /mcp endpoint. */
export function registerTools(server: McpServer, op: OpenPromoter, allowWrite: boolean) {
  for (const t of TOOLS) {
    if (t.write && !allowWrite) continue;
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input,
        annotations: {
          title: t.title,
          readOnlyHint: !t.write,
          destructiveHint: t.hints?.destructive ?? false,
          openWorldHint: t.hints?.openWorld ?? false,
          idempotentHint: t.hints?.idempotent ?? true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const out = await t.run(op, args);
          return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
        } catch (err) {
          const msg =
            err instanceof OpenPromoterError ? `${err.code}: ${err.message}` : (err as Error).message;
          return { isError: true, content: [{ type: "text" as const, text: msg }] };
        }
      },
    );
  }
}
