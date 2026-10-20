#!/usr/bin/env node --no-warnings
/**
 * Evidence test: Stage A adapter implementation dual-review request.
 *
 * Records operator verdict (#834 contract accepted, #833 changes-required).
 * Does not fill reviewer slots, does not accept #833, does not start Stage B.
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
    join(__dirname, "memory-workspace-s01-stage-a-implementation-review-request.json"),
    "utf-8",
  ),
);
const contractPacket = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-a-adapter.json"), "utf-8"),
);
const readinessA = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-implementation-readiness-a.json"), "utf-8"),
);
const scan = JSON.parse(
  readFileSync(
    join(repoRoot, "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json"),
    "utf-8",
  ),
);
const getReply = readFileSync(join(repoRoot, "src/auto-reply/reply/get-reply.ts"), "utf-8");
const getReplyLines = getReply.split("\n");
const identitySrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-steward-workspace-identity.ts"),
  "utf-8",
);
const cwdSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-authorized-tool-cwd.ts"),
  "utf-8",
);

const implementationSidecars = request.requiredImplementationSidecars;
const contractSidecars = request.contractSidecarsAreNotImplementationAccept;

console.log("=== S01 Stage A implementation review request ===\n");

assert.equal(request.kind, "s01-stage-a-implementation-review-request");
assert.equal(request.requestedBy, "cursor-data-governance");
assert.equal(request.selfAccepted, false);
assert.equal(request.fillsKiroSotReviewer, false);
assert.equal(request.fillsCodexArchitecture, false);
assert.equal(request.signedAsKiroSotReviewer, false);
assert.equal(request.signedAsCodexArchitecture, false);
assert.equal(request.flipsImplementationGate, false);
assert.equal(request.authorizesStageAImplementation, false);
assert.equal(request.authorizesStageB, false);
assert.equal(request.acceptsUnauthorizedLanding833, false);
assert.equal(request.thisPacketCreatesReviewSidecars, false);

assert.equal(request.operatorVerdict.stageAContractRemediation834, "accepted");
assert.equal(request.operatorVerdict.stageAAdapterImplementation833, "changes-required");
assert.equal(request.operatorVerdict.stageBShadowWiring, "locked");
assert.equal(request.operatorVerdict.implementationUnlock, "not-issued");
assert.equal(request.operatorVerdict.productionAuthorization, "not-issued");

assert.equal(contractPacket.unauthorizedImplementationLanding.pr, 833);
assert.equal(contractPacket.unauthorizedImplementationLanding.authorized, false);
assert.equal(contractPacket.currentStatus.stageAImplementation, "blocked");
assert.equal(contractPacket.currentStatus.implementationGate, "not-met");
assert.equal(contractPacket.acceptanceCriteria.codeCompleteness.status, "not-met");
assert.equal(contractPacket.acceptanceCriteria.testCoverage.status, "not-met");
assert.equal(contractPacket.acceptanceCriteria.isolationVerification.status, "not-verified");
assert.equal(request.contractPacketObservation.doesNotSign833, true);

assert.equal(request.implementationUnderReview.pr, 833);
assert.equal(request.implementationUnderReview.authorized, false);
assert.equal(request.implementationUnderReview.presentOnMain, true);
assert.ok(
  existsSync(join(repoRoot, "src/gateway/data-governance/s01-steward-workspace-identity.ts")),
);
assert.ok(existsSync(join(repoRoot, "src/gateway/data-governance/s01-authorized-tool-cwd.ts")));

assert.deepEqual(request.requiredReviewers, ["codex-architecture", "kiro-sot-reviewer"]);
assert.equal(implementationSidecars.length, 2);
assert.ok(
  implementationSidecars.every((file) => file.includes("implementation-review")),
  "implementation sidecars must be distinct from contract review filenames",
);
for (const file of [...implementationSidecars, ...contractSidecars]) {
  assert.equal(
    existsSync(join(repoRoot, file)),
    false,
    `${file} must not be created by this packet`,
  );
}
assert.equal(request.sidecarsPresentOnThisOriginMain.implementationReviewCodexArchitecture, false);
assert.equal(request.sidecarsPresentOnThisOriginMain.implementationReviewKiroSotReviewer, false);

assert.deepEqual(request.errorCodesFollowUniqueHandoff, readinessA.errorCodesFollowUniqueHandoff);
assert.deepEqual(request.rejectedParallelCodes, readinessA.rejectedParallelCodes);
for (const code of request.rejectedParallelCodes) {
  assert.doesNotMatch(identitySrc, new RegExp(`"${code}"`));
  assert.doesNotMatch(cwdSrc, new RegExp(`"${code}"`));
}
for (const code of request.errorCodesFollowUniqueHandoff) {
  assert.match(cwdSrc, new RegExp(`"${code}"`));
}

assert.match(identitySrc, /expectedBindingRole:\s*"canonical"/);
assert.match(identitySrc, /fencingToken:/);
assert.match(cwdSrc, /targetIdentity/);
assert.match(cwdSrc, /S01MembershipPort/);
assert.match(cwdSrc, /S01_PRODUCTION_WIRED_TO_GET_REPLY = false/);
assert.doesNotMatch(cwdSrc, /FROM workspace_handles/);
assert.doesNotMatch(identitySrc, /FROM workspace_handles/);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(request.locks.remaining, 10);
assert.equal(request.locks.liveWriteWatchIndex, 10);
assert.equal(request.locks.implementationVerified, false);
assert.equal(request.locks.deployAuthorized, false);
assert.equal(request.locks.liveDeployment, "forbidden");
assert.equal(request.locks.stageB, "locked");
assert.equal(
  request.nextAfterBothImplementationSidecarsOnMain,
  "Stage A Adapter Implementation Accept only",
);

for (const forbidden of [
  "sign as kiro-sot-reviewer",
  "sign as codex-architecture",
  "start Stage B shadow wiring",
  "treat code-on-main as Stage A Accepted",
]) {
  assert.ok(request.explicitlyForbiddenNow.includes(forbidden), forbidden);
}

console.log(
  "✓ Implementation review requested; reviewer slots unfilled; #833 not accepted; Stage B locked\n",
);
