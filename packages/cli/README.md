# openpromoter-cli

```bash
npx openpromoter-cli login --url https://app.openpromoter.com --key op_sk_...
npx openpromoter-cli programs
npx openpromoter-cli stats --program prg_...
npx openpromoter-cli partners list --program prg_...
npx openpromoter-cli payouts prepare --program prg_...   # approval happens in the dashboard
npx openpromoter-cli ask --program prg_... "which partners brought paying customers last month?"
npx openpromoter-cli skill   # installs the agent skill for Claude Code and Cursor
```

`OPENPROMOTER_URL` and `OPENPROMOTER_API_KEY` env vars override the saved login. License: [MIT](LICENSE)
