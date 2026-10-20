import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("live tenant-context path evidence is fixture-only and does not make item 5 met", () => {
  const measured = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item5-live-path-evidence.json"),
      "utf8",
    ),
  );
  const raw = JSON.stringify(measured);
  assert.equal(measured.mockedLoader, false);
  assert.equal(measured.mockedToolCwd, false);
  assert.equal(measured.hostRunnerProbe, false);
  assert.equal(measured.liveTenantContextPassedCatalog, true);
  assert.equal(measured.liveTenantContextPassedAgentAssetId, true);
  assert.equal(measured.registryDisambiguatedAmongMultipleRows, true);
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.item5, "not-met");
  assert.equal(measured.wiredToProductionResolver, false);
  assert.equal(measured.unlock, "not-issued");
  assert.equal(measured.live, false);
  assert.equal(measured.productionCatalogWrite, "none");
  assert.ok(!raw.includes("@"));
  assert.ok(!raw.includes(os.homedir()));
  assert.ok(!raw.includes("/Users/"));
  assert.ok(!raw.includes(".openbot"));
  assert.ok(measured.explicitlyForbidden.includes("treat live path evidence as item 5 met"));
  assert.ok(measured.explicitlyForbidden.includes("wiredToProductionResolver=true"));
});
