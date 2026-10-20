#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage B shadow CR3 review (codex-architecture).
 *
 * Locks accepted for CR3 review only.
 * Does not declare Stage B Implementation Accepted, flip
 * implementationVerified, authorize cutover/LIVE, or replace helper cwd.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const sidecarPath =
  "docs/design/evidence/memory-workspace-s01-stage-b-shadow-cr3-review-codex-architecture.json";
const ownerPacketPath = "docs/design/evidence/memory-workspace-s01-stage-b-shadow-cr3.json";
const scanPath = "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json";
const getReplyPath = "src/auto-reply/reply/get-reply.ts";

const sidecar = JSON.parse(readFileSync(join(repoRoot, sidecarPath), "utf-8"));
const packet = JSON.parse(readFileSync(join(repoRoot, ownerPacketPath), "utf-8"));
const scan = JSON.parse(readFileSync(join(repoRoot, scanPath), "utf-8"));
const getReply = readFileSync(join(repoRoot, getReplyPath), "utf-8");
const cwdSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-authorized-tool-cwd.ts"),
  "utf-8",
);
const portsSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-stage-b-shadow-production-ports.ts"),
  "utf-8",
);
const shadowSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts"),
  "utf-8",
);

function headBlob(path) {
  return execFileSync("git", ["rev-parse", `HEAD:${path}`], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

const reviewedBlobs = {
  "src/auto-reply/reply/get-reply.ts": "1b5d0fe96fc4ccf877af4086fe4f6f635aad5a45",
  "src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts":
    "1aa5a50bf469adecea580a4c22b8e7717c578e28",
  "src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.test.ts":
    "041490339c2d7e389897bcfd7d4a6a44ec9aca38",
  "src/gateway/data-governance/s01-stage-b-shadow-production-ports.ts":
    "1169141d31508beed33a4db440d1d0ca38230cf1",
  "src/gateway/data-governance/s01-stage-b-shadow-production-ports.test.ts":
    "464a09a52d2652979683b5f3628ecfb487abf5ca",
  "src/gateway/data-governance/s01-authorized-tool-cwd.ts":
    "da6e51c111dfd2be7bf5244ae915da67e327a550",
  "src/gateway/data-governance/s01-steward-workspace-identity.ts":
    "90f6d8e5cee7293786982a3af14f53904bc35168",
  "docs/design/evidence/memory-workspace-s01-stage-b-shadow-cr3.json":
    "a859aee5b9519f7c111c359c68efedd4d4298877",
  "docs/design/evidence/memory-workspace-s01-stage-b-cr3-asset-identity-decision.json":
    "8ce83c074e0726bd51bb78009cd485f348b26166",
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json":
    "a32b326dbe7538878dcbc810d5dd86ffddc867a5",
};

console.log("=== S01 Stage B shadow CR3 review (codex-architecture) ===\n");

assert.equal(sidecar.schema, "memory-workspace-s01-stage-b-shadow-cr3-review/v1");
assert.equal(sidecar.kind, "s01-stage-b-shadow-cr3-review");
assert.equal(
  sidecar.taskId,
  "memory-workspace-platform-remediation:codex-architecture-s01-stage-b-shadow-cr3-review",
);
assert.equal(sidecar.reviewer, "codex-architecture");
assert.equal(sidecar.signedBy, "codex-architecture");
assert.equal(sidecar.role, "independent reviewer");
assert.equal(sidecar.scope, "s01-stage-b-shadow-cr3-860");
assert.equal(sidecar.decision, "accepted");
assert.equal(sidecar.reviewRequested, "S01 Stage B Shadow CR3 Review");
assert.equal(sidecar.appliesFor, "S01 Stage B Shadow CR3 Review");
assert.equal(sidecar.authorizesStageBImplementationAccepted, false);
assert.equal(sidecar.authorizesStageBShadowWiring, true);
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
assert.equal(sidecar.packetSelfAccepted, false);
assert.equal(sidecar.thisPacketModifiesProductionCode, false);
assert.equal(sidecar.thisPacketModifiesRetirementScan, false);
assert.equal(sidecar.thisPacketWiresGetReply, false);
assert.equal(sidecar.productionReceiptsObserved, 0);
assert.equal(sidecar.productionReceiptsAcceptanceMet, false);
assert.equal(sidecar.flagDefaultOff, true);
assert.deepEqual(sidecar.openFindings, []);

assert.equal(packet.owner, "cursor-data-governance");
assert.equal(packet.reviewRequested, "S01 Stage B Shadow CR3 Review");
assert.equal(packet.selfAccepted, false);
assert.equal(packet.signedAsCodexArchitecture, false);
assert.equal(packet.authorizesStageBImplementationAccepted, false);
assert.equal(packet.stageBImplementation, "landed-not-accepted");
assert.equal(packet.getReplyStillUsesStewardHelper, true);
assert.equal(packet.flag.name, "OPENBOT_S01_STAGE_B_STEWARD_CWD_SHADOW");
assert.equal(packet.flag.default, "off");

assert.match(headBlob(sidecarPath), /^[0-9a-f]{40}$/);
assert.equal(headBlob(ownerPacketPath), sidecar.reviewedOwnerPacket.blob);
assert.equal(sidecar.reviewedOwnerPacket.blob, reviewedBlobs[ownerPacketPath]);
assert.equal(sidecar.reviewedOwnerPacket.path, ownerPacketPath);
assert.equal(sidecar.reviewedOwnerPacket.owner, "cursor-data-governance");

for (const [path, blob] of Object.entries(reviewedBlobs)) {
  assert.equal(sidecar.mergedBaseline.reviewedBlobs[path], blob, path);
}

assert.equal(sidecar.mergedBaseline.pr860.mergeSha, "d2e23e0e3162018dde9cbbd979b6d222f0a6c788");
assert.equal(sidecar.mergedBaseline.reviewedTip, "d2e23e0e3162018dde9cbbd979b6d222f0a6c788");

for (const [key, value] of Object.entries(sidecar.independentChecks)) {
  assert.equal(value, "pass", key);
}
for (const [key, value] of Object.entries(sidecar.verdict)) {
  assert.equal(value, "pass", key);
}

assert.equal(sidecar.locks.stageBImplementation, "landed-not-accepted");
assert.equal(sidecar.locks.stageBCr3Review, "accepted");
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
assert.match(cwdSrc, /S01_PRODUCTION_WIRED_TO_GET_REPLY = false/);

assert.match(getReply, /resolveEmployeeBuiltinStewardWorkspaceDir/);
const helperLine = getReply
  .split("\n")
  .findIndex((line) => line.includes("resolveEmployeeBuiltinStewardWorkspaceDir"));
assert.ok(helperLine >= 0);
assert.equal(sidecar.productionObservation.getReplyHelperLineNumber, 164);
assert.equal(sidecar.productionObservation.getReplyLine, "src/auto-reply/reply/get-reply.ts:164");
assert.match(getReply, /initSessionState/);
assert.match(getReply, /runS01GetReplyStewardCwdShadowFromEntry/);
assert.ok(
  getReply.indexOf("initSessionState") <
    getReply.indexOf("runS01GetReplyStewardCwdShadowFromEntry"),
);
assert.match(getReply, /sessionId/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
assert.equal(sidecar.productionObservation.getReplyStillUsesStewardHelper, true);
assert.equal(sidecar.productionObservation.getReplyPassesSessionId, true);
assert.equal(sidecar.productionObservation.S01_PRODUCTION_WIRED_TO_GET_REPLY, false);

assert.match(portsSrc, /resolveS01StewardAgentAssetIdFromRegistry/);
assert.match(portsSrc, /createProductionS01StewardRegistryPort/);
assert.match(portsSrc, /loadPlatformAuthStore/);
assert.match(portsSrc, /getSharedDataGovernanceCatalog/);
assert.doesNotMatch(portsSrc, /InMemoryWorkspaceResourceCatalog/);
assert.doesNotMatch(portsSrc, /createInMemoryS01StewardRegistryPort/);
assert.doesNotMatch(portsSrc, /createInMemoryS01MembershipPort/);
assert.match(shadowSrc, /fail_closed_missing_authorization/);
assert.match(shadowSrc, /authorization_denied/);
assert.match(shadowSrc, /identity_and_authorization_match/);
assert.match(shadowSrc, /catalog_miss/);
assert.match(shadowSrc, /tenant_mismatch/);
assert.match(shadowSrc, /fencing_stale/);
assert.match(shadowSrc, /sessionId/);
assert.doesNotMatch(shadowSrc, /\bmkdir\b/);
assert.doesNotMatch(portsSrc, /\bmkdir\b/);

assert.equal(sidecar.nextSlice.helperStillDecidesUserVisibleCwd, true);
assert.equal(sidecar.nextSlice.doNotRetireP5, true);
assert.equal(sidecar.nextSlice.doNotChangeScanTenTen, true);

assert.ok(sidecar.doesNotAuthorize.includes("Stage B Implementation Accepted"));
assert.ok(sidecar.doesNotAuthorize.includes("LIVE authorized"));
assert.ok(sidecar.doesNotAuthorize.includes("implementationVerified=true"));
assert.ok(sidecar.doesNotAuthorize.includes("Phase 1B unlock"));
assert.ok(sidecar.doesNotAuthorize.includes("deployAuthorized=true"));
assert.ok(sidecar.doesNotAuthorize.includes("deleting P5"));
assert.ok(sidecar.doesNotAuthorize.includes("changing remaining or liveWriteWatchIndex"));
assert.ok(sidecar.doesNotAuthorize.includes("enabling production shadow as LIVE"));
assert.ok(sidecar.doesNotAuthorize.includes("treating InMemory receipts as production"));
assert.ok(sidecar.doesNotAuthorize.includes("Stage C"));
assert.ok(sidecar.doesNotAuthorize.includes("Stage D"));
assert.ok(sidecar.doesNotDeclare.includes("Stage B Implementation Accepted"));
assert.ok(sidecar.doesNotDeclare.includes("implementationVerified=true"));
assert.ok(sidecar.doesNotDeclare.includes("LIVE authorized"));

console.log("✓ CR3 review accepted for review-only; helper cwd; scan 10/10; receipts 0\n");
console.log("Status: accepted; Stage B Implementation Accept NOT requested; LIVE forbidden");
