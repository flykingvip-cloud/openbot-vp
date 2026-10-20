#!/usr/bin/env node --no-warnings
/**
 * Evidence test: S01 Stage B shadow landing.
 *
 * Locks helper-decided cwd, default-off flag, scan 10/10, and
 * not-accepted implementation. Does not flip implementationVerified.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "../../..");

const packet = JSON.parse(
  readFileSync(join(__dirname, "memory-workspace-s01-stage-b-shadow.json"), "utf-8"),
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
const shadowSrc = readFileSync(
  join(repoRoot, "src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts"),
  "utf-8",
);

console.log("=== S01 Stage B shadow landing ===\n");

assert.equal(packet.kind, "s01-stage-b-shadow");
assert.equal(packet.owner, "cursor-data-governance");
assert.equal(packet.selfAccepted, false);
assert.equal(packet.signedAsCodexArchitecture, false);
assert.equal(packet.stageBImplementation, "landed-not-accepted");
assert.equal(packet.stageBImplementationAccepted, false);
assert.equal(packet.authorizesStageBImplementationAccepted, false);
assert.equal(packet.authorizesProductionCutover, false);
assert.equal(packet.authorizesStageC, false);
assert.equal(packet.implementationVerified, false);
assert.equal(packet.implementationGate, "not-met");
assert.equal(packet.remaining, 10);
assert.equal(packet.liveWriteWatchIndex, 10);
assert.equal(packet.deployAuthorized, false);
assert.equal(packet.live, "forbidden");
assert.equal(packet.flag.default, "off");
assert.equal(packet.thisPacketWiresProductionCwd, false);

assert.match(getReplyLines[163] ?? "", /resolveEmployeeBuiltinStewardWorkspaceDir/);
assert.match(getReplyLines[164] ?? "", /resolveAgentWorkspaceDir/);
assert.match(getReply, /runS01GetReplyStewardCwdShadowFromEntry/);
assert.doesNotMatch(getReply, /evaluateS01AuthorizedToolCwd/);
assert.doesNotMatch(getReply, /resolveS01StewardWorkspaceIdentity/);
assert.match(cwdSrc, /S01_PRODUCTION_WIRED_TO_GET_REPLY = false/);
assert.match(shadowSrc, /OPENBOT_S01_STAGE_B_STEWARD_CWD_SHADOW/);
assert.match(shadowSrc, /return false;/);
assert.match(shadowSrc, /usedShadowPathForProduction: false/);

assert.equal(scan.remaining, 10);
assert.equal(scan.liveWriteWatchIndex, 10);
assert.equal(scan.sites[0].pathId, "P5");
assert.equal(packet.locks.item7, "not-met");
assert.ok(packet.doesNotAuthorize.includes("Stage B Implementation Accepted"));
assert.ok(packet.doesNotAuthorize.includes("LIVE authorized"));

console.log("✓ Stage B shadow landed, not accepted; helper cwd; scan 10/10\n");
console.log("Status: landed-not-accepted; implementationVerified=false; LIVE forbidden");
