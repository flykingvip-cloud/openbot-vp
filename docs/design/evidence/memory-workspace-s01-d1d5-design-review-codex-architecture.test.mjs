#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 D1–D5 independent design review sidecar (codex-architecture).
 *
 * Does not retire S01. Does not write production Catalog. Does not fill
 * kiro-sot-reviewer. Does not flip implementationGate.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packetPath = join(
  __dirname,
  "memory-workspace-s01-d1d5-design-review-codex-architecture.json",
);
const packet = JSON.parse(readFileSync(packetPath, "utf-8"));
const gatePath = join(__dirname, "memory-workspace-s01-trusted-principal-handle-gate.json");
const gate = JSON.parse(readFileSync(gatePath, "utf-8"));
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");

console.log("=== S01 D1-D5 codex-architecture design review sidecar ===\n");

assert.equal(packet.reviewer, "codex-architecture");
assert.equal(packet.signedBy, "codex-architecture");
assert.equal(packet.decision, "accepted");
assert.equal(packet.reviewPass, 3);
assert.match(packet.signedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
assert.equal(packet.verdict.D1, "pass");
assert.equal(packet.verdict.D2, "pass");
assert.equal(packet.verdict.D3, "pass");
assert.equal(packet.verdict.D4, "pass");
assert.equal(packet.verdict.D5, "pass");
assert.deepEqual(packet.closedFindings, ["SG1", "SG2", "SG3", "SG4", "SG5"]);
assert.equal(packet.mergedBaseline.pr, 816);
assert.equal(packet.locks.productionCatalogWrite, "none");
assert.equal(packet.locks.s01Retirement, "blocked");
assert.equal(packet.locks.item7, "not-met");
assert.equal(packet.locks.phase1b, "blocked");
assert.equal(packet.locks.i3, "not executed");
assert.equal(packet.locks.live, "forbidden");
assert.equal(packet.locks.deployAuthorized, false);
assert.ok(packet.doesNotAuthorize.includes("filling kiro-sot-reviewer slot"));
assert.ok(packet.explicitlyForbidden.includes("sign as kiro-sot-reviewer"));
assert.equal(packet.findings[0].id, "SG1");
assert.equal(gate.implementationGate.status, "not-met");
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.match(getReply, /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.equal(packet.productionObservation.evaluateS01AuthorizedToolCwdImportedBySrc, false);

console.log("✓ sidecar is accepted (pass 3); locks unchanged; kiro-sot-reviewer not filled\n");
console.log(
  "Status: S01 retirement blocked; Item 7 not-met; Phase 1B blocked; I3 not executed; LIVE forbidden",
);
