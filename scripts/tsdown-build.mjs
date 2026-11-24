#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tsImport } from "tsx/esm/api";

// Node 22.12 is supported; do not depend on Node 24 native TS stripping.
const { default: configs } = await tsImport("../tsdown.config.ts", import.meta.url);

// Clean the shared output ONCE, not once per child configuration.
rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });

const logLevel = process.env.OPENCLAW_BUILD_VERBOSE ? "info" : "warn";
// Fresh child per configuration bounds retained graphs / native worker memory.
// Keep every entry and every original option; no reduced release build.
for (let index = 0; index < configs.length; index += 1) {
  console.log(`[build] tsdown configuration ${index + 1}/${configs.length}`);
  const result = spawnSync(
    "pnpm",
    ["exec", "tsdown", "--config-loader", "unrun", "--logLevel", logLevel],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS ?? "2",
        OPENBOT_BUILD_ENTRY_INDEX: String(index),
      },
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
