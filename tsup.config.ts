import { defineConfig } from "tsup";

export default defineConfig([
  // Plugin entry point (loaded by OpenCode's plugin system)
  {
    entry: { plugin: "src/plugin.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["@opencode-ai/plugin", "@opencode-ai/sdk", "bun:sqlite", "better-sqlite3"],
  },
  // CLI entry point (standalone Node.js script)
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    sourcemap: true,
    external: ["bun:sqlite", "better-sqlite3"],
    banner: { js: "#!/usr/bin/env node" },
  },
]);
