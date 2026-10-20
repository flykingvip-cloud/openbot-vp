#!/usr/bin/env node
/**
 * P4 addressing guard: flag bare L1 store loads in request-facing gateway code.
 * Allowlist: platform-auth (login authority), store implementations, tests.
 *
 * Prefers ripgrep when available; falls back to a Node walk (no regex) so CI/dev
 * hosts without `rg` do not get grep -E false positives on literal `()`.
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcRoot = path.join(root, "src");
const patterns = ["loadEnterpriseSeatAssetsStore()", "loadEnterpriseDataStore()"];
const allowPathSubstr = [
  "/platform-auth/",
  "enterprise-seat-assets-store.ts",
  "enterprise-data/store.ts",
  "tenant-store-paths.ts",
  "tenant-context.ts",
  // Unscoped agent-run fallback when no client/tenantId (documented residual).
  "resolve-agent-run-scope.ts",
  // Dual-layout seat→tenant index: reads process-global seat-assets (legacy /
  // pre-MULTITENANT) then per-tenant stores when shared addressing is on.
  // Not a request-path store write; not a silent global fallback for handlers.
  "seat-tenant-index.ts",
  ".test.ts",
  "/test/",
];

/** Pull `src/foo.ts` out of `src/foo.ts:199:  const store = ...` so rg lines are not auto-allowed. */
function extractFilePath(report) {
  const idx = report.indexOf(".ts:");
  return idx >= 0 ? report.slice(0, idx + 3) : report;
}

function isAllowed(filePath, line) {
  const normalized = extractFilePath(filePath).split(path.sep).join("/");
  if (!normalized.endsWith(".ts")) {
    return true;
  }
  if (allowPathSubstr.some((a) => normalized.includes(a) || line.includes(a))) {
    return true;
  }
  return false;
}

function hasRipgrep() {
  const probe = spawnSync("rg", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function ripgrep(pattern) {
  const out = execSync(
    `rg -n -F --glob '*.ts' --glob '!**/node_modules/**' --glob '!**/dist/**' ${JSON.stringify(pattern)} src`,
    { cwd: root, encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

function walkTsFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      walkTsFiles(full, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

function scanWithNode(pattern) {
  const hits = [];
  for (const filePath of walkTsFiles(srcRoot)) {
    const rel = path.relative(root, filePath).split(path.sep).join("/");
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(pattern)) {
        continue;
      }
      const report = `${rel}:${i + 1}:${line}`;
      if (!isAllowed(rel, report)) {
        hits.push(report);
      }
    }
  }
  return hits;
}

function scanPattern(pattern) {
  if (hasRipgrep()) {
    try {
      return ripgrep(pattern).filter((line) => !isAllowed(line, line));
    } catch (e) {
      if (e.status !== 1) {
        throw e;
      }
      return [];
    }
  }
  return scanWithNode(pattern);
}

const hits = [];
for (const p of patterns) {
  hits.push(...scanPattern(p));
}

if (hits.length) {
  console.error("tenant-addressing guard: bare global L1 store loads remain:\n");
  for (const h of hits.slice(0, 50)) {
    console.error(" ", h);
  }
  if (hits.length > 50) {
    console.error(`  ... +${hits.length - 50} more`);
  }
  console.error(
    "\nUse resolveControlPlaneStorePathForClient / resolveTenantControlPlaneStorePath.",
  );
  process.exit(1);
}
console.log("tenant-addressing guard: ok (no unexpected bare L1 loads)");
