import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("Item 7 W2 batch-6 completes write-callers shadow", () => {
  const packet = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item7-w2-batch6-s20-s29-shadow.json"),
      "utf8",
    ),
  );
  assert.equal(packet.sitesWired.length, 2);
  assert.equal(packet.w2WriteCallersComplete, true);
  assert.equal(packet.item7, "not-met");
});
