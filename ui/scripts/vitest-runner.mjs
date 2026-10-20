#!/usr/bin/env node
/**
 * Avoid Vite's default `bundle` config loader, which writes
 * `node_modules/.vite-temp/vitest.config.ts.timestamp-*.mjs` and then `import()`s it.
 * In this worktree `ui/node_modules` is a provenance-tagged stub; operator
 * acceptance gets EPERM on that open. `runner` loads the config in-process.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChildExit } from "../../scripts/test-run-status.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const uiPkg = path.join(here, "../package.json");
const rootPkg = path.join(here, "../../package.json");

function resolveVitestCli() {
  for (const from of [uiPkg, rootPkg]) {
    try {
      const req = createRequire(from);
      const pkgJson = req.resolve("vitest/package.json");
      return path.join(path.dirname(pkgJson), "vitest.mjs");
    } catch {
      // try next
    }
  }
  throw new Error("unable to resolve vitest/vitest.mjs from ui or repo root");
}

const args = process.argv.slice(2);
if (!args.includes("--configLoader")) {
  args.unshift("--configLoader", "runner");
}
// Default browser API listens on ::1:63315; some acceptance sandboxes
// return EPERM on IPv6 loopback. Force IPv4 loopback instead.
if (
  !args.includes("--browser.api.host") &&
  !args.some((arg) => arg.startsWith("--browser.api.host="))
) {
  args.unshift("--browser.api.host", "127.0.0.1");
}

const child = spawn(process.execPath, [resolveVitestCli(), ...args], {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (err) => {
  console.error(`[vitest-runner] failed to start: ${String(err)}`);
  process.exit(1);
});
// A signal death (OOM is SIGKILL) or a missing status must fail the command.
// Re-raising the signal is not a reliable non-zero status for every parent.
child.on("exit", (code, signal) => {
  process.exit(normalizeChildExit(code, signal));
});
