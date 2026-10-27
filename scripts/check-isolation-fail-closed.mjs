#!/usr/bin/env node
/**
 * Static guard: forbid personal-workbench agent roster fail-open and new bare
 * global seat-assets loads outside an allowlist.
 *
 * See docs/design/isolation-layers-hard-rules-2026-08-06.md
 *
 * Optional daibai frame probe (Phase 0 P0 recipient matrix):
 *   node scripts/check-isolation-fail-closed.mjs --daibai-frame
 *   node scripts/check-isolation-fail-closed.mjs --daibai-frame --json
 *
 * Live dual-browser checklist (manual, needs two employee sessions):
 *   1. Open two browsers/profiles; log in as employee A and employee B (same tenant).
 *   2. DevTools → Network → WS → select gateway socket on both.
 *   3. A sends a steward (大白) message containing a unique marker (e.g. ISO-PROBE-<ts>).
 *   4. Assert A's WS frames contain the marker on chat delta/final.
 *   5. Assert B's WS frames do NOT contain the marker (raw frame text search).
 *   6. Repeat across tenants / same groupId if multi-tenant fixtures exist.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Production default: repository root (parent of scripts/).
 * Tests may override with OPENBOT_CHECK_REPO_ROOT so fixtures do not
 * create/delete probes under the live worktree.
 */
function resolveRepoRoot() {
  const override = process.env.OPENBOT_CHECK_REPO_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(__dirname, "..");
}
const repoRoot = resolveRepoRoot();
const SCRIPT_PATH = "scripts/check-isolation-fail-closed.mjs";
const wantDaibaiFrame = process.argv.includes("--daibai-frame");
const wantJson = process.argv.includes("--json");

function runDaibaiFrameProbe() {
  const SUITES = [
    "src/gateway/chat-event-dual-connection.test.ts",
    "src/gateway/chat-event-isolation.test.ts",
    "src/gateway/collaboration-learning/space-snapshot-tenant.test.ts",
  ];
  const probeAt = new Date().toISOString();
  const reportPath = path.join(tmpdir(), `daibai-frame-probe-${randomUUID()}.json`);
  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", ...SUITES, "--reporter=json", `--outputFile=${reportPath}`],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        OPENBOT_TEST_PROFILE: process.env.OPENBOT_TEST_PROFILE || "low",
      },
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );

  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch {
    report = null;
  }
  try {
    fs.unlinkSync(reportPath);
  } catch {
    // ignore
  }

  const cases = [];
  for (const tr of report?.testResults ?? []) {
    for (const a of tr.assertionResults ?? []) {
      cases.push({
        status: a.status,
        name: a.fullName || a.title || "unknown",
      });
    }
  }
  const passed = cases.filter((c) => c.status === "passed").length;
  const failed = cases.filter((c) => c.status === "failed").length;
  const scriptSha256 = createHash("sha256")
    .update(fs.readFileSync(fileURLToPath(import.meta.url)))
    .digest("hex");
  const evidence = {
    evidenceId: `daibai-chat-isolation-frame-${probeAt.slice(0, 10).replaceAll("-", "")}`,
    schema: "daibai-chat-isolation-frame-probe/v1",
    probeUtc: probeAt,
    classification: "automated-frame-recipient-matrix",
    scope:
      "Phase 0 P0 authorized chat fan-out (broadcastToConnIds recipients). Not a production release gate.",
    probe: {
      scriptPath: SCRIPT_PATH,
      scriptSha256,
      mode: "--daibai-frame",
      suites: SUITES,
      exitCode: result.status ?? 1,
    },
    results: {
      total: cases.length || report?.numTotalTests || 0,
      passed: passed || report?.numPassedTests || 0,
      failed: failed || report?.numFailedTests || 0,
      success: (failed || report?.numFailedTests || 0) === 0 && (result.status ?? 1) === 0,
    },
    cases,
    liveDualBrowser: {
      status: "manual-checklist",
      requires: ["two employee sessions", "DevTools WS frame capture"],
      stepsPath: SCRIPT_PATH,
    },
  };

  if (wantJson) {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } else {
    const ok = evidence.results.success ? "PASS" : "FAIL";
    console.log(`[${ok}] daibai frame probe ${evidence.results.passed}/${evidence.results.total}`);
    for (const c of cases) {
      console.log(`  ${c.status}: ${c.name}`);
    }
    if (!evidence.results.success) {
      console.error(
        result.stderr?.slice(0, 4000) || result.stdout?.slice(0, 2000) || "vitest failed",
      );
    }
    console.log("\nLive dual-browser: see checklist in script header (needs two employee logins).");
  }
  process.exit(evidence.results.success ? 0 : 1);
}

if (wantDaibaiFrame) {
  runDaibaiFrameProbe();
}

const scanRoots = [path.join(repoRoot, "src/gateway")];

/** Files allowed to call bare loadEnterpriseSeatAssetsStore() (no path arg). */
const bareSeatAllowlist = new Set([
  "src/gateway/enterprise-seat-assets-store.ts",
  "src/gateway/platform-auth/seat-store-loader.ts",
  "src/gateway/tenant-store-paths.ts",
  "src/gateway/tenant-context.ts",
  // Tests + legacy helpers still migrating; keep explicitly listed.
  "src/gateway/enterprise-seat-assets.ts",
  "src/gateway/enterprise-seat-assets.test.ts",
  "src/gateway/enterprise-operational-identity.ts",
  "src/gateway/enterprise-operational-identity-runtime.ts",
  "src/gateway/enterprise-data/enterprise-data-seat-context.ts",
  "src/gateway/server-methods/enterprise-data.ts",
  "src/gateway/server-methods/enterprise-data-m2.ts",
  "src/gateway/server-methods/enterprise-data-m6.ts",
  "src/gateway/server-methods/billing.ts",
  "src/gateway/server-methods/employee-capability.ts",
  "src/gateway/server-methods/employee-capability.test.ts",
  "src/gateway/server-methods/enterprise-capability.ts",
  "src/gateway/server-methods/enterprise-capability.test.ts",
  "src/gateway/server-methods/enterprise-memory-governance.ts",
  "src/gateway/server-methods/enterprise-organization-monthly-usage.ts",
  "src/gateway/server-methods/enterprise-operational-identity.ts",
  "src/gateway/server-methods/agents-mutate.test.ts",
  "src/gateway/server-methods/spaces.test.ts",
  "src/gateway/platform-auth/routes-trial.ts",
  "src/gateway/platform-auth/routes-trial-review.ts",
  "src/gateway/platform-auth/routes-employee-register.ts",
  "src/gateway/platform-auth/session-context.ts",
  "src/gateway/platform-auth/seat-store-loader.test.ts",
  "src/gateway/platform-auth.test.ts",
  "src/gateway/collaboration-learning/space-store.ts",
  "src/gateway/collaboration-learning/steward-group-policy.ts",
  "src/gateway/collaboration-org-bot-directory.ts",
  "src/gateway/billing/resolve-billing-seat-for-commercial-run.ts",
  "src/gateway/billing/bootstrap-seat-allocation.ts",
  "src/gateway/billing/usage-attribution-backfill.ts",
  "src/gateway/billing/usage-attribution-context.ts",
  "src/gateway/model-entitlement/mirror-billing-grant-to-org-seats.ts",
  "src/gateway/model-entitlement/resolve-agent-run-scope.ts",
  "src/gateway/access-control/authorize.ts",
  "src/gateway/user-operational-identity-enterprise-authorization.ts",
  // Main-origin paths auto-merged during tenant-merge-main; migrate to tenant loader in follow-up.
  "src/gateway/enterprise-operational-identity-oauth/social-oauth.ts",
  "src/gateway/meeting-tencent-meeting-bridge.ts",
  // Cross-tenant seat→tenant index: must read process-global store then per-tenant stores.
  "src/gateway/seat-tenant-index.ts",
]);

const failOpenRosterRe =
  /actor\s*\?\s*filterAgentsForEmployeeActor\s*\([^)]*\)\s*:\s*result\.agents/;
const bareSeatCallRe = /loadEnterpriseSeatAssetsStore\s*\(\s*\)/g;
/** Bare install-wide chat fan-out — must use broadcastChat / broadcastChatEvent. */
const bareChatBroadcastRe = /\bbroadcast\s*\(\s*["']chat["']/;
/**
 * Files that may mention broadcast("chat") in comments describing the ban.
 * Production call sites must use broadcastChat / broadcastChatEvent instead.
 */
const bareChatBroadcastAllowlist = new Set(["src/gateway/chat-abort.ts"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      walk(full, out);
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") || entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];

for (const root of scanRoots) {
  for (const file of walk(root)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const text = fs.readFileSync(file, "utf8");
    if (failOpenRosterRe.test(text)) {
      violations.push(`${rel}: forbidden actor ? filterAgents… : result.agents fail-open`);
    }
    if (rel.endsWith(".test.ts")) {
      continue;
    }
    const bareMatches = text.match(bareSeatCallRe);
    if (bareMatches && !bareSeatAllowlist.has(rel)) {
      violations.push(
        `${rel}: bare loadEnterpriseSeatAssetsStore() — use loadSeatAssetsStoreForTenantId (or add allowlist with justification)`,
      );
    }
    if (bareChatBroadcastRe.test(text) && !bareChatBroadcastAllowlist.has(rel)) {
      violations.push(
        `${rel}: bare broadcast("chat") — use broadcastChat / broadcastChatEvent (daibai isolation P0)`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(
    "isolation fail-closed guard failed:\n" + violations.map((v) => `  - ${v}`).join("\n"),
  );
  process.exit(1);
}

console.log("isolation fail-closed guard: ok");
