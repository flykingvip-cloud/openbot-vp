import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-batch26-s01-s02-personal-local-residual-acceptance.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const getReplyPath = path.join(root, "src/auto-reply/reply/get-reply.ts");
// Baseline this acceptance is built on (origin/main tip at authoring).
const BASELINE = "5ceb199adebf7b5f7aa45c33e37c5e177229af42";

const S01 = {
  file: "src/auto-reply/reply/get-reply.ts",
  line: 164,
  symbol: "resolveEmployeeBuiltinStewardWorkspaceDir",
};
const S02 = {
  file: "src/auto-reply/reply/get-reply.ts",
  line: 165,
  symbol: "resolveAgentWorkspaceDir",
};

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("batch 26 accepts S01/S02 as personal_local residuals and retires nothing", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));

  assert.equal(packet.changeRequest, true);
  assert.equal(packet.changeRequestKind, "personal-local-residual-acceptance");
  assert.equal(packet.reviewRequest, "s01-s02-personal-local-residual-acceptance-review-only");
  assert.equal(packet.reviewRequestIsBatchAccept, false);
  assert.equal(packet.operatorDirected, "A2");

  assert.equal(packet.previousAcceptedBaseline, 10);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.remaining, 10);
  assert.equal(packet.liveWriteWatchIndex, 10);
  assert.equal(packet.proposedRemaining, 10);
  assert.equal(packet.scanModified, false);
  assert.equal(packet.getReplySourceModified, false);
  assert.equal(packet.frozenWriteWatchIndex, 38);

  assert.deepEqual(packet.personalLocalResidualsAccepted, ["S01", "S02"]);
  assert.equal(packet.productionRetirementRemaining, 8);

  assert.equal(packet.item7, "not-met");
  assert.equal(packet.itemMet, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.S01Retired, false);
  assert.equal(packet.S02Retired, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(packet.i3Executed, false);

  assert.equal(Array.isArray(packet.conclusions), true);
  assert.equal(packet.conclusions.length, 5);

  for (const [ev, meta] of [
    [packet.s01Evaluation, S01],
    [packet.s02Evaluation, S02],
  ]) {
    assert.equal(ev.file, meta.file);
    assert.equal(ev.line, meta.line);
    assert.equal(ev.symbol, meta.symbol);
    assert.equal(ev.op, "write");
    assert.equal(ev.acceptedAsResidual, true);
    assert.equal(ev.countedTowardProductionTarget, false);
    assert.equal(ev.managedFailClosed, true);
    assert.equal(ev.honestlyRetirableInProduction, false);
    assert.equal(ev.reachableInManagedEnterprise, false);
  }

  // Two-wall justification present and honest.
  assert.match(packet.twoWallJustification.wall1_semanticGate.ref, /#725/);
  assert.equal(
    packet.twoWallJustification.wall2_freezeSynthesisProhibition.empiricallyConfirmed,
    true,
  );
  assert.match(
    packet.twoWallJustification.wall2_freezeSynthesisProhibition.result,
    /SYNTHESIS_SYMBOL/,
  );

  // Item 7 closure target reframed to the 8 managed/production sites.
  assert.equal(packet.item7ClosureTargetReframe.productionRetirementTarget, 8);
  assert.deepEqual(packet.item7ClosureTargetReframe.personalLocalResidualsExcluded, ["S01", "S02"]);
  assert.equal(packet.item7ClosureTargetReframe.productionSites.length, 8);

  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.baseCommit, BASELINE);
  assert.equal(packet.originMainSha, BASELINE);
});

void test("batch 26 leaves the live scan at 10 with S01 and S02 still present", () => {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  assert.equal(scan.remaining, 10);
  assert.equal(scan.sites.length, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(scan.item7, "not-met");
  for (const s of [S01, S02]) {
    assert.equal(
      scan.sites.some((x) => x.file === s.file && x.line === s.line && x.symbol === s.symbol),
      true,
      `${s.symbol} must remain in the live scan`,
    );
  }
});

void test("batch 26 leaves get-reply.ts S01/S02 source unchanged", () => {
  const src = fs.readFileSync(getReplyPath, "utf8");
  assert.match(src, /resolveEmployeeBuiltinStewardWorkspaceDir\(employeeOwnerId\)/);
  assert.match(src, /resolveAgentWorkspaceDir\(cfg, agentId\)/);
});

void test("batch 26 keeps canonical governance pointers locked", () => {
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(decision.unlock, "not-issued");
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(decision.items["7"], "not-met");
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
