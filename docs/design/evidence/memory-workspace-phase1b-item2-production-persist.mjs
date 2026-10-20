#!/usr/bin/env node
/**
 * Phase 1B item 2 production evidence persist (non-LIVE).
 *
 * Writes classified rows from the production authority dump through the
 * existing catalog-store (put + compareAndPut) into a separate evidence
 * catalog. Does not overwrite the Stage B fixture catalog or runtime Catalog.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(DIR, "../../..");
const RUNNER = path.join(DIR, "memory-workspace-phase1b-item2-production-persist-runner.ts");

const result = spawnSync("bun", [RUNNER], {
  cwd: REPO,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "production evidence persist failed\n");
  process.exit(result.status ?? 1);
}
process.stdout.write(result.stdout);
