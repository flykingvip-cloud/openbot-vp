import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { extractAuthorityCandidate } from "./memory-workspace-phase1b-authority-extract.mjs";
import { measureSeatOccupancy } from "./memory-workspace-phase1b-item2-seat-occupancy.mjs";

const DIR = path.dirname(import.meta.filename);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("production dump occupancy mint stays not-met for item 2 and 5", () => {
  const dump = load("memory-workspace-phase1b-production-authority-dump.json");
  const measured = measureSeatOccupancy(dump);
  const snapshot = load("memory-workspace-phase1b-item2-seat-occupancy.json");
  const extracted = extractAuthorityCandidate(dump, { forbidAgentIdIdentity: true });

  assert.equal(measured.live, false);
  assert.equal(measured.catalogWrite, false);
  assert.equal(measured.hostCatalogWrite, false);
  assert.equal(measured.mintedUserOwnedAgentAsset, false);
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.item5, "not-met");
  assert.equal(measured.wiredToProductionResolver, false);
  assert.equal(measured.occupancyPresent, true);
  assert.ok(measured.occupancyCount >= 1);
  assert.equal(measured.uniqueUserOwnedEquivalent, 0);
  assert.equal(measured.canMintUserOwnedAgentAsset, true);
  assert.equal(measured.occupancyMintableAssetCount, 6);
  assert.equal(measured.reason, "seat_occupancy_mintable_without_unique_user_owned_asset");
  assert.deepEqual(snapshot, measured);
  assert.equal(extracted.candidates.filter((row) => row.ownerType === "occupancy").length, 6);
  assert.ok(measured.explicitlyForbidden.includes("treat occupancy mint as item 2 met"));
});
