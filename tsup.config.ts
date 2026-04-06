import { defineConfig } from "tsup";

export default defineConfig([
  // Plugin entry point (loaded by OpenCode's plugin system)
  {
    entry: { plugin: "src/plugin.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["@opencode-ai/plugin", "@opencode-ai/sdk", "bun:sqlite"],
  },
  // CLI entry point (standalone Bun script)
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    sourcemap: true,
    external: ["bun:sqlite"],
    banner: { js: "#!/usr/bin/env bun" },
  },
]);
