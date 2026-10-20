import assert from "node:assert/strict";
import test from "node:test";
import {
  PATHS,
  loadJson,
  verifyGhEvidencePackR25,
  verifyRunnerStability,
} from "./memory-workspace-phase0-offline-governance-verify.mjs";

void test("review-25 offline gh evidence pack structure (503-bypass, no gh)", () => {
  const pack = loadJson(PATHS.packR25);
  const { ok, errors } = verifyGhEvidencePackR25(pack);
  assert.equal(ok, true, errors.join("; "));
  assert.match(pack.mainSha, /^[0-9a-f]{40}$/);
  assert.equal(pack.governance.phase0Accepted, false);
  assert.equal(pack.governance.deployAuthorized, false);
  assert.equal(pack.governance.closesWsC, false);
});

void test("review-25 runner stability evidence meets 3-cycle bar", () => {
  const stability = loadJson(PATHS.runnerStabilityR25);
  const { ok, errors } = verifyRunnerStability(stability);
  assert.equal(ok, true, errors.join("; "));
  assert.match(stability.mainSha, /^[0-9a-f]{40}$/);
  assert.match(stability.cycles[2].label, /after runner restart/i);
});
