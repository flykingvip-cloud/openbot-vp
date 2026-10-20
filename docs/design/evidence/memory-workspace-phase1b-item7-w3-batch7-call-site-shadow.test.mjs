import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("Item 7 W3 batch-7 wires all 7 P4 synthesis sites", () => {
  const packet = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item7-w3-batch7-call-site-shadow.json"),
      "utf8",
    ),
  );
  assert.equal(packet.sitesWired.length, 7);
  assert.equal(packet.w3CallSiteShadowComplete, true);
  assert.equal(packet.item7, "not-met");
});
