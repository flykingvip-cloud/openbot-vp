#!/usr/bin/env node
/**
 * Phase 1B item 2 Stage B persist runner (non-LIVE evidence catalog).
 *
 * Loads the authority candidate, persists classified rows through the
 * existing catalog-store (put + compareAndPut), and writes quarantine
 * plus coverage measurement. Does not touch production stateDir.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DIR, "../../..");
const RUNNER = path.join(DIR, "memory-workspace-phase1b-item2-stage-b-persist-runner.ts");

const result = spawnSync("bun", [RUNNER], {
  cwd: REPO,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "stage-b persist failed\n");
  process.exit(result.status ?? 1);
}
process.stdout.write(result.stdout);
