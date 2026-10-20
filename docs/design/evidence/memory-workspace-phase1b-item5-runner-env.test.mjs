import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("item 5 runner-env evidence does not upgrade to production met", () => {
  const measured = JSON.parse(
    fs.readFileSync(path.join(DIR, "memory-workspace-phase1b-item5-runner-env.json"), "utf8"),
  );
  assert.equal(measured.status, "not-production-met");
  assert.equal(measured.live, "forbidden");
  assert.equal(measured.productionCatalogWrite, "none");
  assert.equal(measured.mainStewardPath.productionMeasured, false);
  assert.equal(measured.mainStewardPath.proved, "fixture-only");
  assert.equal(measured.phase1bExecutionBlocked, true);
  assert.equal(measured.deployAuthorized, false);
  assert.ok(
    measured.explicitlyForbidden.includes("score production met from host or evidence stateDir"),
  );
});
