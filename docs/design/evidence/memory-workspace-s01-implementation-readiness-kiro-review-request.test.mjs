#!/usr/bin/env node --no-warnings
/**
 * Evidence test: kiro-sot-reviewer V1.8 review request closeout.
 *
 * #830 already signed the kiro sidecar. This packet does not fill or
 * overwrite that sidecar, does not start Stage A, and does not flip
 * implementationGate.
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const request = JSON.parse(
  readFileSync(
    join(__dirname, "memory-workspace-s01-implementation-readiness-kiro-review-request.json"),
    "utf-8",
  ),
);
const sidecar = JSON.parse(
  readFileSync(
    join(__dirname, "memory-workspace-s01-implementation-readiness-review-kiro-sot-reviewer.json"),
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
const uniqueHandoff = readFileSync(join(repoRoot, packet.canonicalHandoffDoc), "utf-8");
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");

console.log("=== S01 V1.8 kiro-sot-reviewer review request closeout ===\n");

assert.equal(request.kind, "s01-implementation-readiness-kiro-review-request");
assert.equal(request.reviewerRequested, "kiro-sot-reviewer");
assert.equal(request.decision, "fulfilled");
assert.equal(request.fulfilledBy.pr, 830);
assert.equal(request.fillsKiroSotReviewer, false);
assert.equal(request.signedAsKiroSotReviewer, false);
assert.equal(request.selfAccepted, false);
assert.equal(request.flipsImplementationGate, false);
assert.equal(request.authorizesStageA, false);
assert.equal(request.thisPacketStartsProductionImplementation, false);
assert.equal(request.alreadyFilled.kiroDecision, "accepted");
assert.equal(request.stillMissing.kiroSotReviewerSidecar, null);

assert.equal(sidecar.reviewer, "kiro-sot-reviewer");
assert.equal(sidecar.signedBy, "kiro-sot-reviewer");
assert.equal(sidecar.decision, "accepted");
assert.equal(sidecar.currentStatus.implementationGate, "not-met");

assert.equal(packet.implementationGate.status, "not-met");
assert.equal(gate.implementationGate.status, "not-met");
assert.equal(request.locks.implementationGate, "not-met");
assert.equal(request.locks.remaining, 10);
assert.equal(request.locks.liveWriteWatchIndex, 10);
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.remaining, scan.liveWriteWatchIndex);
assert.match(uniqueHandoff, /implementationVerified:\s*false/);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReplyLines[164] ?? "", /resolveAgentWorkspaceDir/);
assert.equal(
  existsSync(join(repoRoot, "src/gateway/data-governance/s01-steward-workspace-identity.ts")),
  false,
);
assert.equal(
  existsSync(join(repoRoot, "src/gateway/data-governance/s01-authorized-tool-cwd.ts")),
  false,
);

assert.ok(request.explicitlyForbiddenNow.includes("start Stage A adapter in this packet"));
assert.ok(request.explicitlyForbiddenNow.includes("overwrite kiro-sot-reviewer sidecar"));

console.log("✓ kiro sidecar fulfilled by #830; this packet still does not start Stage A\n");
