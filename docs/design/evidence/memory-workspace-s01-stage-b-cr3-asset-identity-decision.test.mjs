#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage B CR3 Plan A asset-identity decision.
 *
 * Locks Plan A proposed (not accepted, not implemented), no src/ changes,
 * scan 10/10, helper cwd, and no Stage C/D/LIVE authorization.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(
    join(__dirname, "memory-workspace-s01-stage-b-cr3-asset-identity-decision.json"),
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
const portsSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-stage-b-shadow-production-ports.ts"),
  "utf-8",
);
const decisionDoc = readFileSync(
  join(
    repoRoot,
    ".kiro/specs/memory-workspace-platform-remediation/s01-stage-b-cr3-asset-identity-decision.md",
  ),
  "utf-8",
);

console.log("=== S01 Stage B CR3 Plan A asset-identity decision ===\n");

assert.equal(packet.kind, "s01-stage-b-cr3-asset-identity-decision");
assert.equal(packet.owner, "cursor-data-governance");
assert.equal(
  packet.taskId,
  "memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-shadow",
);
assert.equal(packet.decision, "plan-a-position-asset");
assert.equal(packet.decisionStatus, "proposed");
assert.equal(packet.rejectedAlternative, "plan-b-personal-local-only");
assert.equal(packet.selfAccepted, false);
assert.equal(packet.authorizesCr3Implementation, false);
assert.equal(packet.thisPacketModifiesSrc, false);
assert.equal(packet.thisPacketImplementsCr3, false);
assert.equal(packet.inventedMainAgentAssetId, false);
assert.equal(packet.forgedProductionAdapters, false);
assert.equal(packet.stageBImplementation, "landed-not-accepted");
assert.equal(packet.stageBImplementationAccepted, false);
assert.equal(packet.authorizesStageC, false);
assert.equal(packet.authorizesStageCAccept, false);
assert.equal(packet.authorizesStageD, false);
assert.equal(packet.implementationVerified, false);
assert.equal(packet.implementationGate, "not-met");
assert.equal(packet.remaining, 10);
assert.equal(packet.liveWriteWatchIndex, 10);
assert.equal(packet.deployAuthorized, false);
assert.equal(packet.live, "forbidden");
assert.equal(packet.reviewRequested, "S01 Stage B CR3 Plan A asset-identity decision Review");
assert.equal(packet.planA.agentIdMustNotEqualAgentAssetId, true);
assert.equal(packet.planA.stewardSlug, "main");
assert.equal(packet.planB.adopted, false);
assert.equal(packet.contradictionClosed.thisPacketDoesNotChangeThatWrap, true);
assert.ok(packet.cr3Later.requiredReceipts.includes("identity_and_authorization_match"));
assert.ok(packet.cr3Later.requiredReceipts.includes("catalog_miss"));
assert.ok(packet.cr3Later.requiredReceipts.includes("tenant_mismatch"));
assert.ok(packet.cr3Later.requiredReceipts.includes("fencing_stale"));
assert.ok(packet.cr3Later.requiredReceipts.includes("fail_closed_missing_authorization"));
assert.ok(packet.cr3Later.requiredReceipts.includes("authorization_denied"));

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReply, /runS01GetReplyStewardCwdShadowFromEntry/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);

assert.match(portsSrc, /createProductionS01StewardRegistryPort/);
assert.doesNotMatch(portsSrc, /agentAssetId:\s*"main"/);

assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.sites[0].pathId, "P5");

assert.match(decisionDoc, /plan-a-position-asset/);
assert.match(decisionDoc, /decisionStatus\*\*: `proposed`/);
assert.match(decisionDoc, /authorizesCr3Implementation\*\*: `false`/);
assert.match(decisionDoc, /岗位资产/);
assert.doesNotMatch(decisionDoc, /本包实施 CR3/);

assert.ok(packet.doesNotAuthorize.includes("CR3 implementation"));
assert.ok(packet.doesNotAuthorize.includes("Stage C Accept"));
assert.ok(packet.doesNotAuthorize.includes("LIVE authorized"));

console.log("✓ Plan A proposed; CR3 not authorized; src unchanged; scan 10/10\n");
console.log("Status: proposed; implementationVerified=false; LIVE forbidden");
