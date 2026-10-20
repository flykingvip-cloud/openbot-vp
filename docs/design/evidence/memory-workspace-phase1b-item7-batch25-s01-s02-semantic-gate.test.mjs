import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-batch25-s01-s02-semantic-gate.json",
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
const phase0Path = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json",
);
const getReplyPath = path.join(root, "src/auto-reply/reply/get-reply.ts");
// Baseline this CR is built on (origin/main tip bece79d62c, PR #711 merge).
const BASELINE = "bece79d62c0bce91bf7d30a28948f40cfccbc515";

const S01 = {
  ledgerId: "S01",
  file: "src/auto-reply/reply/get-reply.ts",
  line: 164,
  symbol: "resolveEmployeeBuiltinStewardWorkspaceDir",
};
const S02 = {
  ledgerId: "S02",
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

void test("batch 25 S01/S02 semantic-gate CR carries the mandated status fields and retires nothing", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));

  // Mandated status fields.
  assert.equal(packet.previousAcceptedBaseline, 10);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.remaining, 10);
  assert.equal(packet.liveWriteWatchIndex, 10);
  assert.equal(packet.batch25Accepted, false);
  assert.equal(packet.stageBSemanticGate, "blocked");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.itemMet, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.fullUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.absorbsUnacceptedBatches, false);
  assert.equal(packet.S01Retired, false);
  assert.equal(packet.S02Retired, false);
  assert.equal(packet.deleteCallSites, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(packet.i3Executed, false);

  // CR, not a retirement, not a batch accept; baseline never decremented.
  assert.equal(packet.changeRequest, true);
  assert.equal(packet.changeRequestKind, "semantic-gate");
  assert.deepEqual(packet.sites, ["S01", "S02"]);
  assert.equal(packet.reviewRequest, "s01-s02-semantic-gate-cr-review-only");
  assert.equal(packet.reviewRequestIsBatchAccept, false);
  assert.equal(packet.proposedRemaining, 10);
  assert.notEqual(packet.proposedRemaining, 9);
  assert.notEqual(packet.proposedRemaining, 8);
  assert.equal(packet.scanModified, false);
  assert.equal(packet.getReplySourceModified, false);
  assert.equal(packet.s25AcceptedStatusPreserved, true);
  assert.equal(packet.s26SemanticGateStatusPreserved, true);
  assert.equal(packet.sitesInScope, 2);
  assert.equal(packet.sitesHonestlyRetirable, 0);

  // Conclusions present (8 mandated conclusions).
  assert.equal(Array.isArray(packet.conclusions), true);
  assert.equal(packet.conclusions.length, 8);

  // Per-site evaluations: personal_local create lifecycle, binding not pre-existing, circular, params insufficient.
  for (const [ev, meta] of [
    [packet.s01Evaluation, S01],
    [packet.s02Evaluation, S02],
  ]) {
    assert.equal(ev.ledgerId, meta.ledgerId);
    assert.equal(ev.file, meta.file);
    assert.equal(ev.line, meta.line);
    assert.equal(ev.symbol, meta.symbol);
    assert.equal(ev.op, "write");
    assert.equal(ev.honestlyRetirable, false);
    assert.equal(ev.replacementImplemented, false);
    assert.equal(ev.deleteNow, false);
    assert.equal(ev.lifecycle, "provisioning/create");
    assert.equal(ev.personalLocalOnly, true);
    assert.equal(ev.bindingExistsAtCallSite, false);
    assert.match(ev.circularDependency, /circular/i);
    assert.match(ev.paramsOnlyInsufficient, /catalog\/grant\/cfg/);
    for (const q of ["resourceId", "catalog", "tenantContext", "tenantId", "actor", "grant"]) {
      assert.equal(ev.missingQueryInputs.includes(q), true, `missing query input ${q}`);
    }
  }

  // S02 is authoritative: LEGACY_LOCATOR_CALLER_MATRIX P1 forbids the swap (fails closed).
  assert.deepEqual(packet.s02Evaluation.legacyMatrix, {
    pathId: "P1",
    symbol: "resolveAgentWorkspaceDir",
    file: "src/auto-reply/reply/get-reply.ts",
    shape: "agentId-only",
    expectedReasonCode: "agent_id_slug_query_forbidden",
  });

  // Honest path: provisioning + identity threading, mirroring the accepted provisioning command.
  assert.match(packet.unlockDesign.pattern, /provisionEmployeeStewardCutoverWorkspace/);
  assert.equal(packet.unlockDesign.contract.length, 8);

  // Locks and stage gates.
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.stageCStarted, false);
  assert.equal(packet.stageDStarted, false);
  assert.equal(packet.s27Reviewed, false);
  assert.equal(packet.frozenWriteWatchIndex, 38);
  assert.equal(packet.baseCommit, BASELINE);
  assert.equal(packet.originMainSha, BASELINE);
});

void test("batch 25 S01/S02 semantic-gate CR leaves the live scan at 10 with S01 and S02 still present", () => {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));

  assert.equal(scan.remaining, 10);
  assert.equal(scan.sites.length, 10);
  assert.equal(scan.liveWriteWatchIndex, 10);
  assert.equal(scan.liveWriteWatchIndex, scan.remaining);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(scan.phase0Rewritten, false);
  assert.equal(scan.i3Executed, false);

  for (const s of [S01, S02]) {
    assert.equal(
      scan.sites.some((x) => x.file === s.file && x.line === s.line && x.symbol === s.symbol),
      true,
      `${s.ledgerId} must remain in the live scan`,
    );
  }
});

void test("batch 25 S01/S02 semantic-gate CR leaves get-reply.ts:164/165 byte-unchanged", () => {
  const lines = fs.readFileSync(getReplyPath, "utf8").split("\n");
  // 1-indexed line numbers -> 0-indexed array positions.
  assert.match(lines[S01.line - 1], /resolveEmployeeBuiltinStewardWorkspaceDir\(employeeOwnerId\)/);
  assert.match(lines[S02.line - 1], /resolveAgentWorkspaceDir\(cfg, agentId\)/);
});

void test("batch 25 S01/S02 semantic-gate CR keeps canonical governance pointers blocked", () => {
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const phase0 = JSON.parse(fs.readFileSync(phase0Path, "utf8"));

  assert.equal(phase0.productionWriteWatchIndex, 38);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(decision.items["7"], "not-met");

  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
