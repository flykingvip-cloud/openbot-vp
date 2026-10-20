import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { measureProductionInventoryCoverage } from "./memory-workspace-phase1b-item2-production-inventory.mjs";

const DIR = path.dirname(import.meta.filename);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("runtime catalog layout persist stays isolated and does not make item 2 or 5 met", () => {
  const measured = load("memory-workspace-phase1b-item2-runtime-catalog-persist.json");
  const catalog = load("memory-workspace-phase1b-item2-runtime-state/data-governance/catalog.json");
  const inventory = measureProductionInventoryCoverage();

  assert.equal(measured.live, false);
  assert.equal(measured.hostCatalogWrite, false);
  assert.equal(measured.productionCatalogWrite, "none");
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.item5, "not-met");
  assert.equal(measured.wiredToProductionResolver, false);
  assert.equal(measured.liveLoaderMatchedUserOwnedAsset, false);
  assert.equal(measured.liveLoaderResult, "empty");
  assert.equal(measured.persisted.length, 22);
  assert.equal(Object.keys(catalog.records).length, 22);
  assert.ok(measured.catalogPath.startsWith("docs/design/evidence/"));
  assert.ok(measured.catalogPath.endsWith("data-governance/catalog.json"));
  assert.ok(!measured.catalogPath.includes(".openbot"));
  assert.equal(inventory.covered, false);
  assert.equal(inventory.runtimeCatalogLayoutPersisted, true);
  assert.equal(inventory.reason, "production_classified_merged_to_host_catalog_item2_not_met");
  assert.ok(measured.explicitlyForbidden.includes("host ~/.openbot Catalog write"));
});
