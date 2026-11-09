# openpromoter-cli

Command line for [OpenPromoter](https://openpromoter.com), the open-source affiliate and referral platform for SaaS. Check stats and manage partners, commissions and payouts from your terminal.

```bash
npx openpromoter-cli login --url https://app.openpromoter.com --key op_live_...   # op_sk_... on a self-hosted URL
npx openpromoter-cli programs
npx openpromoter-cli stats --program prg_...
npx openpromoter-cli partners list --program prg_...
npx openpromoter-cli payouts prepare --program prg_...   # approval happens in the dashboard
npx openpromoter-cli ask --program prg_... "which partners brought paying customers last month?"
npx openpromoter-cli skill   # installs the agent skill for Claude Code, Codex and Cursor
```

`OPENPROMOTER_URL` and `OPENPROMOTER_API_KEY` env vars override the saved login. Full reference: [openpromoter.com/docs/cli](https://openpromoter.com/docs/cli/).

License: [MIT](LICENSE)
