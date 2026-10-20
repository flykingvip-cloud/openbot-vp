import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-locator-contract.json",
);
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const handoffPath = path.join(
  root,
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-locator-contract.md",
);
const runtimePath = path.join(root, "src/gateway/workspace-resolver/strict-locator.ts");
const getReplyPath = path.join(root, "src/auto-reply/reply/get-reply.ts");

void test("item 7 locator contract keeps locks and does not delete call-sites", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.itemMet, false);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.fullUnlock, "not-issued");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.wiredToProductionResolver, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.deleteCallSites, false);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.liveWriteWatchIndex, 37);
  assert.equal(packet.preflightRequiredBeforeCallSiteDeletion, true);
  assert.equal(packet.independentRetirementReviewAccepted, false);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.deployAuthorized, false);
  assert.equal(unlock.wiredToProductionResolver, false);
  assert.equal(unlock.liveCutover, false);
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(
    packet.doesNotModify.includes(
      "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
    ),
    true,
  );
});

void test("item 7 locator contract is not wired into a production P1 caller", () => {
  const runtime = fs.readFileSync(runtimePath, "utf8");
  const getReply = fs.readFileSync(getReplyPath, "utf8");
  assert.match(runtime, /resolveWorkspaceLocator/);
  assert.doesNotMatch(getReply, /resolveWorkspaceLocator/);
  assert.match(getReply, /resolveAgentWorkspaceDir/);
});

void test("item 7 locator contract handoff requests contract review only", () => {
  const handoff = fs.readFileSync(handoffPath, "utf8");
  assert.match(handoff, /Locator Contract Review only/);
  assert.match(handoff, /not\*\* delete/);
  assert.doesNotMatch(handoff, /liveWriteWatchIndex=0/);
});
