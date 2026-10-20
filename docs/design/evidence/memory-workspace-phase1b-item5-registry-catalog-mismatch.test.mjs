import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const PACKET = path.join(DIR, "memory-workspace-phase1b-item5-registry-catalog-mismatch.json");

void test("mismatch packet splits raw InCatalog membership from the live-miss diagnostic", () => {
  const packet = JSON.parse(fs.readFileSync(PACKET, "utf8"));
  const measured = packet.measured;
  const perUser = measured.perUser;
  const inCatalogTrue = perUser.filter((row) => row.registryResolvedInCatalog === true);
  const inCatalogFalse = perUser.filter((row) => row.registryResolvedInCatalog === false);
  const liveHit = perUser.filter((row) => row.missReason === "live_hit");
  const diagnostic = perUser.filter(
    (row) => row.missReason === "registry_resolved_asset_not_in_catalog",
  );

  assert.equal(packet.status, "not-met");
  assert.equal(packet.wiredToProductionResolver, false);
  assert.equal(measured.item5, "not-met");
  assert.equal(measured.wiredToProductionResolver, false);
  assert.equal(measured.rootCause, "none");
  assert.equal(packet.fieldSemantics.consistent, true);
  assert.equal(measured.usersWithRegistryResolvedNotInCatalog, diagnostic.length);
  assert.equal(measured.perUserMissReasonRegistryResolvedNotInCatalog, diagnostic.length);
  assert.equal(measured.perUserMissReasonLiveHit, liveHit.length);
  assert.equal(measured.perUserRegistryResolvedInCatalogTrue, inCatalogTrue.length);
  assert.equal(measured.perUserRegistryResolvedInCatalogFalse, inCatalogFalse.length);
  assert.equal(liveHit.length, 7);
  assert.equal(diagnostic.length, 0);
  assert.equal(inCatalogFalse.length, 6);
  assert.ok(
    inCatalogFalse.length !== measured.usersWithRegistryResolvedNotInCatalog,
    "raw InCatalog=false must not be the closeout diagnostic",
  );
  assert.ok(
    packet.explicitlyForbidden.includes(
      "treat per-user registryResolvedInCatalog=false as usersWithRegistryResolvedNotInCatalog",
    ),
  );
  assert.ok(packet.explicitlyForbidden.includes("score item 5 met from this diagnosis"));
  assert.ok(
    !JSON.stringify(packet).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i),
  );
});
