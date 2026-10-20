#!/usr/bin/env node
/**
 * Knowledge space unification acceptance gate (W9).
 * Runs the automated test bundle mapped in:
 * docs/design/openbot-knowledge-space-unification-acceptance-report-2026-06-29.md
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeChildExit } from "./test-run-status.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const testPaths = [
  "src/gateway/knowledge/knowledge-base-permissions.test.ts",
  "src/gateway/knowledge/knowledge-base-sources-list.test.ts",
  "src/gateway/knowledge/knowledge-compat.test.ts",
  "src/gateway/knowledge/knowledge-compat-stats.test.ts",
  "src/gateway/knowledge/knowledge-source-binding-visibility-backfill.test.ts",
  "src/gateway/server-methods/knowledge-base-rpc.test.ts",
  "src/gateway/knowledge/ingest-parse-options.test.ts",
  "src/gateway/server-methods/knowledge-personal-ingest-rpc.test.ts",
  "src/gateway/server-methods/knowledge-deliverables-attach-rpc.test.ts",
  "ui/src/ui/views/knowledge-universe-library-grouping.node.test.ts",
  "ui/src/ui/views/knowledge-universe-create-entry.node.test.ts",
  "ui/src/ui/views/knowledge-universe-space-import.node.test.ts",
  "ui/src/ui/views/knowledge-universe-url-import.node.test.ts",
  "ui/src/ui/views/knowledge-universe-file-import.node.test.ts",
  "ui/src/ui/views/knowledge-universe-note-import.node.test.ts",
  "ui/src/ui/views/knowledge-universe-note-ai.node.test.ts",
  "ui/src/ui/views/knowledge-universe-space-connector-bind.node.test.ts",
  "ui/src/ui/views/enterprise-data-connector-credential-helpers.node.test.ts",
  "ui/src/ui/views/knowledge-universe-space-ingest.node.test.ts",
  "ui/src/ui/views/knowledge-universe-supply-spaces.node.test.ts",
  "ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts",
  "ui/src/ui/views/knowledge-universe-governance.browser.test.ts",
];

const env = {
  ...process.env,
  OPENBOT_TEST_PROFILE: process.env.OPENBOT_TEST_PROFILE ?? "low",
};

const result = spawnSync("pnpm", ["test", ...testPaths], {
  cwd: root,
  env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`[test-knowledge-space] failed to start: ${String(result.error)}`);
  process.exit(1);
}
process.exit(normalizeChildExit(result.status, result.signal));
