#!/usr/bin/env node
import path from "node:path";

/**
 * Prints selected files as NUL-delimited tokens to stdout.
 *
 * Usage:
 *   node scripts/pre-commit/filter-staged-files.mjs lint -- <files...>
 *   node scripts/pre-commit/filter-staged-files.mjs format -- <files...>
 *
 * Keep this dependency-free: the pre-commit hook runs in many environments.
 */

const mode = process.argv[2];
const rawArgs = process.argv.slice(3);
const files = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

if (mode !== "lint" && mode !== "format") {
  process.stderr.write("usage: filter-staged-files.mjs <lint|format> -- <files...>\n");
  process.exit(2);
}

const lintExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const formatExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);

// Keep in sync with .oxfmtrc.jsonc ignorePatterns that would leave oxfmt with
// zero real targets (it exits: "Expected at least one target file").
const formatIgnoredPrefixes = [
  ".kiro/specs/constitutional-governance-discovery/",
  ".kiro/specs/gateway-plugins-monolith-decomposition/baseline/",
  "docs/zh-CN/",
  "packages/constitutional-contracts/",
  "apps/",
  "assets/",
  "dist/",
  "docs/_layouts/",
  "node_modules/",
  "patches/",
  "Swabble/",
  "vendor/",
];

// Exact paths from .oxfmtrc.jsonc ignorePatterns. A solo commit of one of
// these files otherwise reaches oxfmt and exits with no target.
const formatIgnoredExact = new Set([
  "src/commands/agent.ts",
  "src/gateway/server-methods/agents.ts",
  "src/gateway/server-methods/skills.ts",
  "src/gateway/workspace/handler-bridge.ts",
  "src/gateway/workspace-resolver/steward-write.ts",
  "src/memory/backend-config.ts",
  "src/memory/cogniweave-manager.ts",
  "src/memory/manager-sync-ops.ts",
  "src/memory/manager.ts",
  "src/memory/qmd-manager.ts",
]);

const shouldSelect = (filePath) => {
  const normalized = filePath.replaceAll("\\", "/");
  const ext = path.extname(normalized).toLowerCase();
  if (mode === "lint") {
    return lintExts.has(ext);
  }
  if (formatIgnoredExact.has(normalized)) {
    return false;
  }
  if (
    formatIgnoredPrefixes.some(
      (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
    )
  ) {
    return false;
  }
  return formatExts.has(ext);
};

for (const file of files) {
  if (shouldSelect(file)) {
    process.stdout.write(file);
    process.stdout.write("\0");
  }
}
