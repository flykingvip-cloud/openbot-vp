import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");

void test("Item 7 W2 batch-4 packet covers S14-S15 wired + S10-S13 deferred", () => {
  const packet = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item7-w2-batch4-s10-s15-shadow.json"),
      "utf8",
    ),
  );
  assert.equal(packet.batch, 4);
  assert.equal(packet.sitesWired.length, 2);
  assert.equal(packet.sitesDeferred.length, 4);
  assert.equal(fs.existsSync(path.join(REPO, packet.sidecar)), true);
});
