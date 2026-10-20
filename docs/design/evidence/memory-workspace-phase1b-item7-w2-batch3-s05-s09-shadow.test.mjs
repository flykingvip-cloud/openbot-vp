import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item7-w2-batch3-s05-s09-shadow.json";

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("Item 7 W2 batch-3 packet covers S05-S09 without production write switch", () => {
  const packet = load(PACKET);
  assert.equal(packet.batch, 3);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.sites.length, 5);
  assert.equal(fs.existsSync(path.join(REPO, "src/gateway/checkpoint-store-w2-shadow.ts")), true);
});
