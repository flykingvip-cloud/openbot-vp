import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item7-w2-batch2-s03-s06-shadow.json";

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("Item 7 W2 batch-2 packet covers S03-S06 without wiring production write", () => {
  const packet = load(PACKET);
  assert.equal(packet.batch, 2);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.wiredToThisCallSite, false);
  assert.equal(packet.liveWriteWatchIndex, 37);
  assert.equal(packet.sites.length, 2);
  assert.equal(packet.deferredSites.length, 2);
  assert.equal(fs.existsSync(path.join(REPO, "src/commands/agent.ts")), true);
  assert.equal(fs.existsSync(path.join(REPO, "src/commands/status-all/agents.ts")), true);
});
