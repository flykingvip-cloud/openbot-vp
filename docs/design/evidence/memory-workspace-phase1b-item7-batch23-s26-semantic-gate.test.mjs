import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-batch23-s26-semantic-gate.json",
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
// Baseline this CR is built on (origin/main tip 67cfe64d44, PR #675).
const BASELINE = "67cfe64d44a974b4a2c5d51a1a06a4c66bd01acf";

const S26 = {
  ledgerId: "S26",
  file: "src/gateway/workspace-resolver/steward-write.ts",
  line: 279,
  symbol: "resolveEmployeeStewardSourceWorkspaceDir",
};

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("batch 23 S26 semantic-gate CR carries the mandated §7 status fields and retires nothing", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));

  // §7 mandated status fields.
  assert.equal(packet.previousAcceptedBaseline, 12);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.remaining, 12);
  assert.equal(packet.liveWriteWatchIndex, 12);
  assert.equal(packet.batch23Accepted, false);
  assert.equal(packet.stageBSemanticGate, "blocked");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.absorbsUnacceptedBatches, false);
  assert.equal(packet.S26Retired, false);
  assert.equal(packet.S27Retired, false);

  // CR, not a retirement, not a batch accept; baseline never decremented.
  assert.equal(packet.changeRequest, true);
  assert.equal(packet.site, "S26");
  assert.equal(packet.reviewRequest, "stage-b-s26-semantic-gate-cr-review-only");
  assert.equal(packet.reviewRequestIsBatchAccept, false);
  assert.equal(packet.proposedRemaining, 12);
  assert.notEqual(packet.proposedRemaining, 11);
  assert.notEqual(packet.proposedRemaining, 8);
  assert.equal(packet.scanModified, false);
  assert.equal(packet.s25AcceptedStatusPreserved, true);

  // §5 conclusions present (8 mandated conclusions).
  assert.equal(Array.isArray(packet.conclusions), true);
  assert.equal(packet.conclusions.length, 8);

  // S26 evaluation: creation lifecycle, binding not pre-existing, circular dependency, params insufficient.
  const s = packet.s26Evaluation;
  assert.equal(s.ledgerId, S26.ledgerId);
  assert.equal(s.file, S26.file);
  assert.equal(s.line, S26.line);
  assert.equal(s.symbol, S26.symbol);
  assert.equal(s.honestlyRetirable, false);
  assert.equal(s.replacementImplemented, false);
  assert.equal(s.prerequisiteMet, false);
  assert.equal(s.lifecycle, "provisioning/create");
  assert.equal(s.bindingExistsAtCallSite, false);
  assert.match(s.circularDependency, /circular/i);
  assert.match(s.paramsOnlyInsufficient, /catalog\/grant\/cfg/);

  // §6 unlock design: provisionEmployeeStewardCutoverWorkspace with a 10-point contract.
  assert.equal(packet.unlockDesign.command, "provisionEmployeeStewardCutoverWorkspace");
  assert.equal(packet.unlockDesign.contract.length, 10);

  // Locks and stage gates.
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.stageCStarted, false);
  assert.equal(packet.stageDStarted, false);
  assert.equal(packet.s01Reviewed, false);
  assert.equal(packet.s02Reviewed, false);
  assert.equal(packet.s27Reviewed, false);
  assert.equal(packet.originMainSha, BASELINE);
});

void test("batch 23 S26 semantic-gate CR leaves the live scan at 12 with S26 still present", () => {
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));

  assert.equal(scan.remaining, 12);
  assert.equal(scan.sites.length, 12);
  assert.equal(scan.liveWriteWatchIndex, 12);
  assert.equal(scan.liveWriteWatchIndex, scan.remaining);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(scan.frozenWriteWatchIndex, 38);
  assert.equal(scan.phase0Rewritten, false);
  assert.equal(scan.i3Executed, false);

  assert.equal(
    scan.sites.some((x) => x.file === S26.file && x.line === S26.line && x.symbol === S26.symbol),
    true,
    "S26 must remain in the live scan",
  );
});

void test("batch 23 S26 semantic-gate CR keeps canonical governance pointers blocked", () => {
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const phase0 = JSON.parse(fs.readFileSync(phase0Path, "utf8"));

  assert.equal(phase0.productionWriteWatchIndex, 38);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(decision.phase1bExecutionBlocked, true);

  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
