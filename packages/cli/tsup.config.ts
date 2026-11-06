import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["openpromoter"],
  define: { __SKILL__: JSON.stringify(readFileSync("../../skills/openpromoter/SKILL.md", "utf8")) },
});
