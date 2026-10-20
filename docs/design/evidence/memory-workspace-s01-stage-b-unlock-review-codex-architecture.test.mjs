#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage B unlock review (codex-architecture).
 *
 * Locks accepted + issued-for-shadow-implementation-only.
 * Does not declare Stage B Implementation Accepted, flip
 * implementationVerified, authorize cutover/LIVE, or wire get-reply.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const sidecar = JSON.parse(
  readFileSync(
    join(__dirname, "memory-workspace-s01-stage-b-unlock-review-codex-architecture.json"),
    "utf-8",
  ),
);
const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-b-unlock-decision.json"), "utf-8"),
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const codex = JSON.parse(
  readFileSync(
    join(__dirname, "memory-workspace-s01-stage-a-implementation-review-codex-architecture.json"),
    "utf-8",
  ),
);
const kiro = JSON.parse(
  readFileSync(
    join(__dirname, "memory-workspace-s01-stage-a-implementation-review-kiro-sot-reviewer.json"),
    "utf-8",
  ),
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
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const cwdSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-authorized-tool-cwd.ts"),
  "utf-8",
);

function headBlob(path) {
  return execFileSync("git", ["rev-parse", `HEAD:${path}`], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

console.log("=== S01 Stage B unlock review (codex-architecture) ===\n");

assert.equal(sidecar.kind, "s01-stage-b-unlock-review");
assert.equal(sidecar.reviewer, "codex-architecture");
assert.equal(sidecar.signedBy, "codex-architecture");
assert.equal(sidecar.role, "independent reviewer");
assert.equal(sidecar.decision, "accepted");
assert.equal(sidecar.stageBUnlock, "issued-for-shadow-implementation-only");
assert.equal(sidecar.authorizesStageBShadowWiring, true);
assert.equal(sidecar.authorizesStageBImplementationAccepted, false);
assert.equal(sidecar.authorizesProductionCutover, false);
assert.equal(sidecar.authorizesStageC, false);
assert.equal(sidecar.authorizesStageD, false);
assert.equal(sidecar.authorizesStageE, false);
assert.equal(sidecar.implementationVerified, false);
assert.equal(sidecar.implementationGate, "not-met");
assert.equal(sidecar.remaining, 10);
assert.equal(sidecar.liveWriteWatchIndex, 10);
assert.equal(sidecar.deployAuthorized, false);
assert.equal(sidecar.live, "forbidden");
assert.equal(sidecar.fillsKiroSotReviewer, false);
assert.equal(sidecar.flipsImplementationGate, false);
assert.equal(sidecar.packetSelfAccepted, false);
assert.equal(sidecar.thisPacketWiresGetReply, false);
assert.equal(sidecar.thisPacketModifiesProductionCode, false);
assert.equal(sidecar.thisPacketModifies848DecisionPacket, false);
assert.deepEqual(sidecar.openFindings, []);

assert.equal(packet.decision, "conditions-met");
assert.equal(packet.stageBUnlockIssued, false);
assert.equal(packet.selfAccepted, false);
assert.equal(packet.signedAsCodexArchitecture, false);
assert.equal(packet.thisPacketCreatesReviewSidecar, false);
assert.equal(packet.authorizesStageBShadowWiring, false);
assert.equal(
  headBlob("docs/design/evidence/memory-workspace-s01-stage-b-unlock-decision.json"),
  "a43ddd2889e0a4c2f56de45099ff79e9cc52ca64",
);
assert.equal(
  headBlob("docs/design/evidence/memory-workspace-s01-stage-b-unlock-decision.test.mjs"),
  "f824e90977cb0d8808c12fc2a2c0a516f7fca37a",
);
assert.equal(sidecar.reviewedOwnerPacket.blob, "a43ddd2889e0a4c2f56de45099ff79e9cc52ca64");

assert.equal(codex.decision, "accepted");
assert.equal(codex.reviewPass, 2);
assert.equal(codex.ia1, "closed");
assert.equal(codex.ia2, "closed");
assert.equal(codex.stageAAdapterImplementation, "accepted");
assert.equal(codex.authorizesStageB, false);
assert.equal(kiro.decision, "accepted");
assert.equal(kiro.reviewPass, 2);
assert.equal(kiro.ia1, "closed");
assert.equal(kiro.ia2, "closed");
assert.equal(kiro.stageAAdapterImplementation, "accepted");
assert.equal(kiro.authorizesStageB, false);

const expectedBlobs = {
  "src/gateway/data-governance/s01-steward-workspace-identity.ts":
    "90f6d8e5cee7293786982a3af14f53904bc35168",
  "src/gateway/data-governance/s01-authorized-tool-cwd.ts":
    "da6e51c111dfd2be7bf5244ae915da67e327a550",
  "src/gateway/data-governance/s01-steward-workspace-identity.test.ts":
    "e3b8150c301effb86e0a851960fe0069c9a07424",
  "src/gateway/data-governance/s01-authorized-tool-cwd.test.ts":
    "38d78ffc3f89ac438b7c0cd3093ab667e2cf0eac",
};
for (const [path, blob] of Object.entries(expectedBlobs)) {
  assert.equal(headBlob(path), blob, path);
  assert.equal(sidecar.mergedBaseline.reviewedBlobs[path], blob, path);
}

for (const [key, value] of Object.entries(sidecar.independentChecks)) {
  assert.equal(value, "pass", key);
}
for (const [key, value] of Object.entries(sidecar.verdict)) {
  assert.equal(value, "pass", key);
}

assert.equal(sidecar.locks.stageB, "unlocked-for-shadow-implementation-only");
assert.equal(sidecar.locks.stageBUnlock, "issued-for-shadow-implementation-only");
assert.equal(sidecar.locks.stageBImplementation, "not-started");
assert.equal(sidecar.locks.implementationVerified, false);
assert.equal(sidecar.locks.implementationGate, "not-met");
assert.equal(sidecar.locks.remaining, 10);
assert.equal(sidecar.locks.liveWriteWatchIndex, 10);
assert.equal(sidecar.locks.item7, "not-met");
assert.equal(sidecar.locks.phase1b, "blocked");
assert.equal(sidecar.locks.deployAuthorized, false);
assert.equal(sidecar.locks.live, "forbidden");
assert.equal(sidecar.locks.productionCatalogWrite, "none");
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.sites[0].pathId, "P5");
assert.equal(scan.sites[0].symbol, "resolveEmployeeBuiltinStewardWorkspaceDir");
assert.match(contract, /S01_IMPLEMENTATION_VERIFIED = false/);
assert.match(uniqueHandoff, /implementationVerified: false/);
assert.match(cwdSrc, /S01_PRODUCTION_WIRED_TO_GET_REPLY = false/);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReplyLines[164] ?? "", /resolveAgentWorkspaceDir/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
assert.equal(sidecar.productionObservation.getReplyStillUsesStewardHelper, true);
assert.equal(sidecar.productionObservation.S01_PRODUCTION_WIRED_TO_GET_REPLY, false);

assert.equal(sidecar.nextSlice.helperStillDecidesUserVisibleCwd, true);
assert.equal(sidecar.nextSlice.doNotRetireP5, true);
assert.equal(sidecar.nextSlice.doNotChangeScanTenTen, true);

assert.ok(sidecar.doesNotAuthorize.includes("Stage B Implementation Accepted"));
assert.ok(sidecar.doesNotAuthorize.includes("production cutover authorized"));
assert.ok(sidecar.doesNotAuthorize.includes("LIVE authorized"));
assert.ok(sidecar.doesNotDeclare.includes("Stage B Implementation Accepted"));
assert.ok(sidecar.doesNotDeclare.includes("implementationVerified=true"));
assert.ok(sidecar.doesNotDeclare.includes("Item 7 met"));
assert.ok(sidecar.doesNotDeclare.includes("Phase 1B unlocked"));
assert.ok(sidecar.doesNotDeclare.includes("I3 complete"));
assert.ok(sidecar.doesNotDeclare.includes("LIVE authorized"));

assert.equal(sidecar.mergedBaseline.originMain, "5dfa5745c505580a32d0612af44f27b88a1ac3b9");
assert.equal(sidecar.mergedBaseline.pr848.mergeSha, "5dfa5745c505580a32d0612af44f27b88a1ac3b9");
assert.equal(sidecar.mergedBaseline.pr848.branchShaIsAncestorOfMain, false);

console.log("✓ Stage B unlock issued for shadow only; get-reply unwired; scan 10/10\n");
console.log("Status: accepted; implementationVerified=false; LIVE forbidden");
