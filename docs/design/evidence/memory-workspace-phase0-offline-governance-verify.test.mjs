import assert from "node:assert/strict";
import test from "node:test";
import {
  PATHS,
  loadJson,
  verifyGhEvidencePack,
  verifyOfflineGovernance,
  verifyRunnerStability,
} from "./memory-workspace-phase0-offline-governance-verify.mjs";

void test("503-bypass offline governance verify passes on committed r25 packs", () => {
  const result = verifyOfflineGovernance({ expectReviewSequence: 25 });
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.match(result.mainSha, /^[0-9a-f]{40}$/);
});

void test("r25 gh evidence pack meets governance invariants (no gh)", () => {
  const pack = loadJson(PATHS.packR25);
  const { ok, errors } = verifyGhEvidencePack(pack, { expectReviewSequence: 25 });
  assert.equal(ok, true, errors.join("; "));

  const pr409 = pack.commands.find((c) => c.id === "pr409-view");
  assert.equal(pr409.parsed.mergeCommit.oid, "d261378ff3d283d134a6ed4088e836842380294d");
});

void test("r25 runner stability pack meets 3-cycle bar (no gh)", () => {
  const stability = loadJson(PATHS.runnerStabilityR25);
  const { ok, errors } = verifyRunnerStability(stability);
  assert.equal(ok, true, errors.join("; "));
  assert.equal(stability.consecutiveSuccessCount, 3);
});
