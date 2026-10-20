#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage B shadow CR3.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-b-shadow-cr3.json"), "utf-8"),
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
  join(repoRoot, ".kiro/specs/memory-workspace-platform-remediation/s01-stage-b-shadow-cr3.md"),
  "utf-8",
);

console.log("=== S01 Stage B shadow CR3 ===\n");

assert.equal(packet.kind, "s01-stage-b-shadow-cr3");
assert.equal(packet.planAAccepted, true);
assert.equal(packet.selfAccepted, false);
assert.equal(packet.authorizesStageC, false);
assert.equal(packet.authorizesStageD, false);
assert.equal(packet.implementationVerified, false);
assert.equal(packet.remaining, 10);
assert.equal(packet.liveWriteWatchIndex, 10);
assert.equal(packet.live, "forbidden");
assert.equal(packet.inventedMainAgentAssetId, false);
assert.equal(packet.thisPacketWiresProductionCwd, false);
assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReply, /runS01GetReplyStewardCwdShadowFromEntry/);
assert.match(getReply, /sessionId/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
assert.match(portsSrc, /resolveS01StewardAgentAssetIdFromRegistry/);
assert.match(portsSrc, /agentSlug === S01_STEWARD_SLUG/);
assert.doesNotMatch(portsSrc, /InMemoryWorkspaceResourceCatalog/);
assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.sites[0].pathId, "P5");
assert.match(decisionDoc, /Plan A/);
assert.ok(packet.requiredReceipts.includes("identity_and_authorization_match"));
assert.ok(packet.doesNotAuthorize.includes("Stage C Accept"));
assert.ok(packet.doesNotAuthorize.includes("LIVE authorized"));
console.log("✓ CR3 packet locked; helper cwd; Plan A registry; sessionId passed\n");
