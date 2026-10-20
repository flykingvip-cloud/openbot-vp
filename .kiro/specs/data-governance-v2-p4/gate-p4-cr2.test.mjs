import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const design = fs.readFileSync(path.join(DIR, "design-p4.md"), "utf8");
const doc = JSON.parse(fs.readFileSync(path.join(DIR, "gate-p4-cr2.json"), "utf8"));

void test("P4 CR3: trustedRegionDefault is on the input and is the only default-region source", () => {
  assert.equal(doc.resubmit, "CR3");
  assert.equal(doc.codingUnlocked, false);
  assert.equal(doc.trustedRegionField, "trustedRegionDefault");
  assert.match(design, /trustedRegionDefault: string \| null;/);
  assert.match(design, /platform deployment-region receipt bound to `auth\.tenantId`/);
  assert.match(design, /There is no `deploymentDefault` field/);
  assert.doesNotMatch(
    design,
    /selected = first\(deploymentDefault ∩/,
    "CR2 used undefined deploymentDefault in the region formula",
  );
  assert.match(design, /missing_trusted_region/);
  assert.ok(doc.denyReasonCodes.includes("missing_trusted_region"));
});

void test("P4 CR3: replay loads receipt before requiring unused grant", () => {
  const loadIdx = design.indexOf("Load receipt by `replayId` first");
  const unusedIdx = design.indexOf('require grant `grantKind: "cognitive_promotion_apply"');
  const casIdx = design.indexOf(
    "unique-create receipt (`prepared`) keyed by `replayId` **and** `unused → consumed`",
  );
  assert.ok(loadIdx > 0, "receipt lookup must be written");
  assert.ok(unusedIdx > loadIdx, "unused-grant check must come after receipt lookup");
  assert.ok(casIdx > unusedIdx, "consume CAS must come after unused check");
  assert.match(design, /Do not require `grant\.state == unused`/);
  assert.match(design, /cannot start a new apply/);
  assert.deepEqual(doc.replayOrder, [
    "compute replayId",
    "load receipt by replayId",
    "return existing receipt without unused check",
    "else require unused grant",
    "CAS unique-create receipt and consume grant",
  ]);
});
