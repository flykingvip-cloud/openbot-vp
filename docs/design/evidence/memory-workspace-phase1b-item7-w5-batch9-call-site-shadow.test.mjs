import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("Item 7 W5 batch-9 wires all 8 index/dir sites", () => {
  const packet = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item7-w5-batch9-call-site-shadow.json"),
      "utf8",
    ),
  );
  assert.equal(packet.sitesWired.length, 8);
  assert.equal(packet.w5CallSiteShadowComplete, true);
  assert.equal(packet.item7, "not-met");
});
