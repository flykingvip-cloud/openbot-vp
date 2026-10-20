import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("Item 6 read-only foreign keys packet stays not-met", () => {
  const packet = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase1b-item6-implementation-read-only-foreign-keys.json"),
      "utf8",
    ),
  );
  assert.equal(packet.item6, "not-met");
  assert.equal(packet.productionSqliteWrite, false);
});
