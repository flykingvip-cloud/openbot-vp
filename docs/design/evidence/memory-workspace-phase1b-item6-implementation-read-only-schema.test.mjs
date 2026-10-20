import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item6-implementation-read-only-schema.json";

void test("Item 6 read-only schema packet stays not-met", () => {
  const packet = JSON.parse(fs.readFileSync(path.join(DIR, PACKET), "utf8"));
  assert.equal(packet.item6, "not-met");
  assert.equal(packet.productionSqliteWrite, false);
  assert.equal(fs.existsSync(path.join(REPO, packet.runtime)), true);
});
