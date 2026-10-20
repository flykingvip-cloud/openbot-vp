import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item7-w2-batch1-s02-shadow.json";
const CURRENT = "memory-workspace-phase1b-unlock-current.json";

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("Item 7 W2 batch-1 S02 shadow packet stays not-met and legacy-only", () => {
  const packet = load(PACKET);
  const current = load(CURRENT);
  assert.equal(packet.wave, "W2-write-callers");
  assert.equal(packet.siteId, "S02-get-reply");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.wiredToThisCallSite, false);
  assert.equal(packet.liveWriteWatchIndex, 37);
  assert.equal(packet.productionWrite, "legacy-only");
  assert.equal(current.item7ImplementationUnlocked, true);
  assert.equal(
    fs.existsSync(path.join(REPO, "src/memory/item7-w2-dark-dual-read-shadow.ts")),
    true,
  );
  assert.equal(fs.existsSync(path.join(REPO, "src/auto-reply/reply/get-reply.ts")), true);
});
