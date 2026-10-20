#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 V1.8 implementation-readiness architecture review
 * sidecar (codex-architecture).
 *
 * Does not retire S01. Does not write production Catalog. Does not fill
 * kiro-sot-reviewer. Does not flip implementationGate. Does not start Stage A.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const sidecar = JSON.parse(
  readFileSync(
    join(__dirname, "memory-workspace-s01-implementation-readiness-review-codex-architecture.json"),
    "utf-8",
  ),
);
const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-implementation-readiness.json"), "utf-8"),
);
const gate = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-trusted-principal-handle-gate.json"), "utf-8"),
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");

console.log("=== S01 V1.8 codex-architecture implementation-readiness review ===\n");

assert.equal(sidecar.reviewer, "codex-architecture");
assert.equal(sidecar.signedBy, "codex-architecture");
assert.equal(sidecar.decision, "accepted");
assert.equal(sidecar.reviewPass, 1);
assert.match(sidecar.signedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
assert.equal(sidecar.fillsKiroSotReviewer, false);
assert.equal(sidecar.flipsImplementationGate, false);
assert.equal(sidecar.packetSelfAccepted, false);
assert.equal(sidecar.authorizesStageA, false);
assert.equal(sidecar.mergedBaseline.pr, 827);
assert.deepEqual(sidecar.closedFindings, ["IR1", "IR2", "IR3", "IR4"]);
assert.equal(sidecar.verdict.IR1, "pass");
assert.equal(sidecar.verdict.IR2, "pass");
assert.equal(sidecar.verdict.IR3, "pass");
assert.equal(sidecar.verdict.IR4, "pass");
assert.equal(sidecar.architectureReview.mappingChainDefined, true);
assert.equal(sidecar.architectureReview.shadowDistinctFromCutover, true);
assert.equal(sidecar.architectureReview.cutoverHasNoRuntimeHelperFallback, true);
assert.equal(sidecar.architectureReview.stagesAEIndependentGates, true);
assert.equal(sidecar.architectureReview.doesNotPlanNineOverTen, true);

assert.equal(packet.status, "implementation-readiness-resubmitted");
assert.equal(packet.selfAccepted, false);
assert.equal(packet.planVersion, "V1.8");
assert.equal(packet.implementationGate.status, "not-met");
assert.equal(gate.implementationGate.status, "not-met");
assert.equal(sidecar.locks.implementationGate, "not-met");
assert.equal(sidecar.locks.s01Retirement, "blocked");
assert.equal(sidecar.locks.item7, "not-met");
assert.equal(sidecar.locks.phase1b, "blocked");
assert.equal(sidecar.locks.i3, "not executed");
assert.equal(sidecar.locks.live, "forbidden");
assert.equal(sidecar.locks.deployAuthorized, false);
assert.equal(sidecar.locks.remaining, 10);
assert.equal(sidecar.locks.liveWriteWatchIndex, 10);
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReplyLines[164] ?? "", /resolveAgentWorkspaceDir/);
assert.equal(sidecar.productionObservation.getReplyStillUsesStewardHelper, true);
assert.equal(sidecar.productionObservation.evaluateS01AuthorizedToolCwdImportedBySrc, false);

assert.ok(sidecar.doesNotAuthorize.includes("filling kiro-sot-reviewer slot"));
assert.ok(sidecar.doesNotAuthorize.includes("Stage A start"));
assert.ok(sidecar.explicitlyForbidden.includes("sign as kiro-sot-reviewer"));
assert.equal(
  existsSync(
    join(__dirname, "memory-workspace-s01-implementation-readiness-review-kiro-sot-reviewer.json"),
  ),
  false,
);

console.log("✓ architecture sidecar accepted; locks unchanged; kiro-sot-reviewer not filled\n");
console.log(
  "Status: S01 retirement blocked; Item 7 not-met; Phase 1B blocked; I3 not executed; LIVE forbidden",
);
