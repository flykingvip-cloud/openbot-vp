import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("Item 7 W2 batch-4b packet covers S10-S13", () => {
  const packet = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item7-w2-batch4b-s10-s13-shadow.json"),
      "utf8",
    ),
  );
  assert.equal(packet.sitesWired.length, 4);
  assert.equal(packet.item7, "not-met");
});
