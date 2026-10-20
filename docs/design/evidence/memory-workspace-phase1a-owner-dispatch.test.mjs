import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("phase1a owner dispatch covers four owners and does not self-sign", () => {
  const doc = JSON.parse(
    fs.readFileSync(path.join(DIR, "memory-workspace-phase1a-owner-dispatch.json"), "utf8"),
  );
  assert.equal(doc.section141Signed, false);
  assert.equal(doc.phase1bExecutionBlocked, true);
  assert.equal(doc.deployAuthorized, false);
  const targets = doc.dispatches.map((d) => d.to);
  assert.deepEqual(targets, [
    "codex-workspace-architecture",
    "cursor-data-governance",
    "cursor-memory-wsc",
    "cursor-fable",
  ]);
  assert.ok(!targets.includes("cursor-memory-platform"));
  const roles = doc.dispatches.flatMap((d) => d.roles);
  assert.deepEqual(new Set(roles).size, 7);
});
