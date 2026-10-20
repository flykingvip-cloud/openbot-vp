import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const acceptedPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-preflight-accepted.json",
);
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-preflight.json",
);
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const getReplyPath = path.join(root, "src/auto-reply/reply/get-reply.ts");
const applyHandoffPath = path.join(
  root,
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-retirement-preflight-apply.md",
);

void test("item 7 retirement preflight accepted receipt keeps locks", () => {
  const accepted = JSON.parse(fs.readFileSync(acceptedPath, "utf8"));
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  assert.equal(accepted.independentRetirementReviewAccepted, true);
  assert.equal(accepted.deleteCallSites, false);
  assert.equal(accepted.retirementExecuted, false);
  assert.equal(accepted.item7, "not-met");
  assert.equal(accepted.liveWriteWatchIndex, 37);
  assert.equal(accepted.retiredThisChange, 0);
  assert.equal(accepted.phase1bExecutionBlocked, true);
  assert.equal(accepted.deployAuthorized, false);
  assert.equal(accepted.wiredToProductionResolver, false);
  assert.equal(accepted.live, "forbidden");
  assert.equal(packet.independentRetirementReviewAccepted, true);
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
});

void test("item 7 retirement preflight accepted does not wire production callers", () => {
  const getReply = fs.readFileSync(getReplyPath, "utf8");
  assert.match(getReply, /resolveAgentWorkspaceDir/);
  assert.doesNotMatch(getReply, /resolveWorkspaceLocator\(/);
});

void test("item 7 retirement preflight apply handoff requests apply review only", () => {
  const handoff = fs.readFileSync(applyHandoffPath, "utf8");
  assert.match(handoff, /Retirement Preflight Apply Review only/);
  assert.match(handoff, /independentRetirementReviewAccepted=true/);
  assert.doesNotMatch(handoff, /liveWriteWatchIndex=0/);
});
