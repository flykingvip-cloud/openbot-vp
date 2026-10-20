import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("host catalog merge evidence is sanitized and does not make item 2 or 5 met", () => {
  const measured = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item2-host-catalog-persist.json"),
      "utf8",
    ),
  );
  const raw = JSON.stringify(measured);
  assert.equal(measured.hostCatalogWrite, true);
  assert.equal(measured.productionCatalogWrite, "host-merge-authorized");
  assert.equal(measured.mintedUserOwnedFromOccupancy, true);
  assert.ok(measured.occupancyMintedCount >= 1);
  assert.equal(measured.item2, "not-met");
  assert.equal(measured.item5, "not-met");
  assert.equal(measured.wiredToProductionResolver, false);
  assert.equal(measured.unlock, "not-issued");
  assert.equal(measured.live, false);
  assert.ok(!raw.includes("@"));
  assert.ok(!raw.includes(os.homedir()));
  assert.ok(!raw.includes("/Users/"));
  assert.ok(!raw.includes(".openbot"));
  assert.ok(!Object.hasOwn(measured, "persisted"));
  assert.ok(!Object.hasOwn(measured, "catalogPath"));
  assert.ok(measured.explicitlyForbidden.includes("write unredacted dump to docs/"));
  assert.ok(measured.explicitlyForbidden.includes("treat host Catalog merge as item 2 met"));
});
