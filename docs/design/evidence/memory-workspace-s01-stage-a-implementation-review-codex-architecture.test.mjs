#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage A implementation architecture review pass 2.
 *
 * Locks IA1/IA2 closed and Stage A Adapter Implementation accepted.
 * Does not apply Stage A Accept, unlock Stage B, flip
 * implementationVerified, or wire get-reply.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const sidecar = JSON.parse(
  readFileSync(
    join(__dirname, "memory-workspace-s01-stage-a-implementation-review-codex-architecture.json"),
    "utf-8",
  ),
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const cwdSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-authorized-tool-cwd.ts"),
  "utf-8",
);
const identitySrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-steward-workspace-identity.ts"),
  "utf-8",
);
const contract = readFileSync(
  join(repoRoot, "docs/design/contracts/s01-trusted-principal-handle-contract.ts"),
  "utf-8",
);
const uniqueHandoff = readFileSync(
  join(
    repoRoot,
    ".kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md",
  ),
  "utf-8",
);

console.log("=== S01 Stage A implementation architecture review pass 2 ===\n");

assert.equal(sidecar.reviewer, "codex-architecture");
assert.equal(sidecar.signedBy, "codex-architecture");
assert.equal(sidecar.decision, "accepted");
assert.equal(sidecar.stageAAdapterImplementation, "accepted");
assert.equal(sidecar.reviewPass, 2);
assert.equal(sidecar.scope, "s01-stage-a-implementation-844");
assert.equal(sidecar.ia1, "closed");
assert.equal(sidecar.ia2, "closed");
assert.equal(sidecar.fillsKiroSotReviewer, false);
assert.equal(sidecar.authorizesStageAAccept, false);
assert.equal(sidecar.authorizesStageB, false);
assert.equal(sidecar.flipsImplementationGate, false);
assert.equal(sidecar.acceptsUnauthorizedLanding833, false);
assert.deepEqual(sidecar.openFindings, []);
assert.equal(sidecar.verdict.governanceContentFencing, "pass");
assert.equal(sidecar.verdict.uniqueCanonicalActiveBinding, "pass");
assert.equal(sidecar.verdict.getReplyUnwired, "pass");
assert.equal(sidecar.verdict.scanTenTen, "pass");
assert.equal(sidecar.verdict.implementationVerifiedFalse, "pass");
assert.equal(sidecar.verdict.stageBLocked, "pass");

const ia1 = sidecar.findings.find((finding) => finding.id === "IA1");
const ia2 = sidecar.findings.find((finding) => finding.id === "IA2");
assert.equal(ia1.status, "closed");
assert.equal(ia2.status, "closed");
assert.match(cwdSrc, /target\.governanceVersion/);
assert.match(cwdSrc, /target\.contentVersion/);
assert.match(cwdSrc, /target\.fencingToken/);
assert.match(cwdSrc, /target\.expectedBindingState !== "active"/);
assert.match(identitySrc, /expectedBindingState: "active";/);
assert.doesNotMatch(identitySrc, /expectedBindingState: "active" \| "read_only"/);
assert.match(cwdSrc, /ERR_WORKSPACE_ARCHIVED/);
assert.match(cwdSrc, /ERR_BINDING_NOT_CANONICAL/);

assert.equal(sidecar.handoffErrorCodes.length, 11);
for (const extra of sidecar.forbiddenExtraErrorCodes) {
  assert.doesNotMatch(cwdSrc, new RegExp(extra));
  assert.doesNotMatch(identitySrc, new RegExp(extra));
}
assert.doesNotMatch(cwdSrc, /CREATE\s+TABLE/i);
assert.doesNotMatch(identitySrc, /CREATE\s+TABLE/i);
assert.match(cwdSrc, /WorkspaceResourceCatalog/);
assert.match(identitySrc, /WorkspaceResourceCatalog/);
assert.match(cwdSrc, /arrays are not accepted/);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReplyLines[164] ?? "", /resolveAgentWorkspaceDir/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
assert.equal(sidecar.productionObservation.getReplyStillUsesStewardHelper, true);
assert.equal(sidecar.productionObservation.S01_PRODUCTION_WIRED_TO_GET_REPLY, false);
assert.match(cwdSrc, /S01_PRODUCTION_WIRED_TO_GET_REPLY = false/);

assert.equal(sidecar.locks.stageB, "locked");
assert.equal(sidecar.locks.stageAImplementation, "accepted");
assert.equal(sidecar.locks.implementationVerified, false);
assert.equal(sidecar.locks.implementationGate, "not-met");
assert.equal(sidecar.locks.item7, "not-met");
assert.equal(sidecar.locks.phase1b, "blocked");
assert.equal(sidecar.locks.live, "forbidden");
assert.equal(sidecar.locks.deployAuthorized, false);
assert.equal(sidecar.locks.remaining, 10);
assert.equal(sidecar.locks.liveWriteWatchIndex, 10);
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.match(contract, /S01_IMPLEMENTATION_VERIFIED = false/);
assert.match(uniqueHandoff, /implementationVerified: false/);

assert.ok(sidecar.doesNotAuthorize.includes("Stage B shadow wiring"));
assert.ok(sidecar.doesNotAuthorize.includes("Stage A Adapter Implementation Accept packet"));
assert.ok(sidecar.doesNotAuthorize.includes("filling kiro-sot-reviewer slot"));
assert.equal(sidecar.mergedBaseline.originMain, "e5134c6ee49db6752b34dbeb699b4bf430390452");

console.log("✓ pass 2 accepts Stage A Adapter Implementation; IA1/IA2 closed; Stage B locked\n");
console.log("Status: scan 10/10; implementationVerified=false; LIVE forbidden");
