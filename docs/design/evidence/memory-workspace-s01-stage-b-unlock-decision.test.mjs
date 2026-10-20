#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage B unlock decision.
 *
 * Locks conditions-met + unlock proposed, not issued. Does not wire
 * get-reply, flip implementationVerified, or self-sign as architecture.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

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

console.log("=== S01 Stage B unlock decision ===\n");

assert.equal(packet.kind, "s01-stage-b-unlock-decision");
assert.equal(packet.owner, "cursor-data-governance");
assert.equal(packet.role, "stage-b-unlock-packet-owner");
assert.equal(packet.originMain, "ffd40b16a5a75b908f5bc523faf1d6390d44195e");
assert.equal(packet.selfAccepted, false);
assert.equal(packet.signedAsCodexArchitecture, false);
assert.equal(packet.signedAsKiroSotReviewer, false);
assert.equal(packet.fillsCodexArchitecture, false);
assert.equal(packet.packetSelfAccepted, false);
assert.equal(packet.decision, "conditions-met");
assert.equal(packet.stageBShadowUnlock, "proposed");
assert.equal(packet.stageBUnlockIssued, false);
assert.equal(packet.authorizesStageBImplementation, false);
assert.equal(packet.authorizesStageBShadowWiring, false);
assert.equal(packet.authorizesStageC, false);
assert.equal(packet.authorizesStageD, false);
assert.equal(packet.authorizesStageE, false);
assert.equal(packet.flipsImplementationGate, false);
assert.equal(packet.thisPacketWiresGetReply, false);
assert.equal(packet.thisPacketModifiesProductionCode, false);
assert.equal(packet.thisPacketCreatesReviewSidecar, false);
assert.equal(packet.requiredReviewer, "codex-architecture");

assert.equal(packet.operatorVerdict.stageAAdapterImplementation, "accepted");
assert.equal(packet.operatorVerdict.stageBShadowWiring, "locked");
assert.equal(packet.operatorVerdict.implementationUnlock, "not-issued");
assert.equal(packet.operatorVerdict.productionAuthorization, "not-issued");

assert.equal(codex.decision, "accepted");
assert.equal(codex.ia1, "closed");
assert.equal(codex.ia2, "closed");
assert.equal(codex.stageAAdapterImplementation, "accepted");
assert.equal(codex.authorizesStageB, false);
assert.equal(kiro.decision, "accepted");
assert.equal(kiro.ia1, "closed");
assert.equal(kiro.ia2, "closed");
assert.equal(kiro.stageAAdapterImplementation, "accepted");
assert.equal(kiro.authorizesStageB, false);

for (const [key, value] of Object.entries(packet.minimumUnlockChecks)) {
  assert.equal(value, "pass", key);
}

assert.equal(packet.locks.stageB, "locked");
assert.equal(packet.locks.stageBUnlock, "proposed-not-issued");
assert.equal(packet.locks.implementationVerified, false);
assert.equal(packet.locks.implementationGate, "not-met");
assert.equal(packet.locks.remaining, 10);
assert.equal(packet.locks.liveWriteWatchIndex, 10);
assert.equal(packet.locks.item7, "not-met");
assert.equal(packet.locks.deployAuthorized, false);
assert.equal(packet.locks.live, "forbidden");
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
assert.equal(packet.productionObservation.getReplyStillUsesStewardHelper, true);

assert.ok(packet.doesNotAuthorize.includes("Stage B shadow wiring implementation"));
assert.ok(packet.doesNotAuthorize.includes("self-issuing Stage B unlock"));
assert.ok(packet.doesNotAuthorize.includes("LIVE"));

console.log("✓ Stage B unlock proposed, not issued; get-reply unwired; scan 10/10\n");
console.log("Status: conditions-met; implementationVerified=false; LIVE forbidden");
