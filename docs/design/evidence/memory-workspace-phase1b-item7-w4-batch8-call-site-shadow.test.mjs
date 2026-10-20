import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("Item 7 W4 batch-8 wires all 6 P5 steward helper sites", () => {
  const packet = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item7-w4-batch8-call-site-shadow.json"),
      "utf8",
    ),
  );
  assert.equal(packet.sitesWired.length, 6);
  assert.equal(packet.w4CallSiteShadowComplete, true);
  assert.equal(packet.item7, "not-met");
});
