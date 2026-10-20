import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");

void test("Item 7 W2 batch-5 packet covers S16 S18 S19", () => {
  const packet = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item7-w2-batch5-s16-s19-shadow.json"),
      "utf8",
    ),
  );
  assert.equal(packet.sitesWired.length, 3);
  assert.equal(fs.existsSync(path.join(REPO, "src/gateway/chat-w2-shadow.ts")), true);
});
