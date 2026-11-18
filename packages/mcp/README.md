# openpromoter-mcp

MCP server for [OpenPromoter](https://openpromoter.com). Ask your agent "which partners brought paying customers last month?" or "draft a double-commission campaign for annual plans".

```json
{
  "mcpServers": {
    "openpromoter": {
      "command": "npx",
      "args": ["-y", "openpromoter-mcp"],
      "env": { "OPENPROMOTER_API_KEY": "op_live_...", "OPENPROMOTER_URL": "https://app.openpromoter.com" }
    }
  }
}
```

It works with any MCP client: Claude Desktop, Claude Code, Codex, Cursor, VS Code with GitHub Copilot, Windsurf, Gemini CLI, Zed and others. Keys from Cloud start with `op_live_`. A self-hosted instance gives `op_sk_` keys; set `OPENPROMOTER_URL` to its address. Setup for each client: [openpromoter.com/docs/mcp](https://openpromoter.com/docs/mcp/).

Apps that connect to a URL (Claude, ChatGPT, Cursor and others) can skip the API key. Add `https://app.openpromoter.com/mcp` as a connector, or `https://your-openpromoter-url/mcp` when self-hosting. You sign in, pick a workspace and choose read-only or read and write. The app gets its own API key, which you can revoke in Settings > API & webhooks.

- Read tools are always available: `list_programs`, `program_stats`, `list_partners`, `get_partner`, `list_commissions`, `list_payouts`, `autopilot_suggestions`, `ask`.
- Write tools appear only with `OPENPROMOTER_MCP_WRITE=true` and the API key's scopes: `invite_partner`, `set_partner_status`, `draft_campaign`, `apply_autopilot_action`, `prepare_payouts`.
- No tool can send money. `prepare_payouts` creates a batch that a person approves in the dashboard.

License: [MIT](LICENSE)
