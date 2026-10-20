import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);

void test("phase1a section141 close record matches the signed matrix and stays Phase 1B blocked", () => {
  const closed = JSON.parse(
    fs.readFileSync(path.join(DIR, "memory-workspace-phase1a-section141-closed.json"), "utf8"),
  );
  const matrix = JSON.parse(
    fs.readFileSync(
      path.join(DIR, "memory-workspace-phase0-section141-signoff-matrix.json"),
      "utf8",
    ),
  );

  assert.equal(closed.section141Signed, true);
  assert.equal(matrix.section141Signed, true);
  assert.equal(closed.signedCount, 7);
  assert.equal(matrix.signedCount, 7);
  assert.equal(closed.phase1bExecutionBlocked, true);
  assert.equal(matrix.phase1bExecutionBlocked, true);
  assert.equal(closed.deployAuthorized, false);
  assert.equal(closed.mergedPr, 442);
  assert.equal(closed.nextDispatch.to, "codex-workspace-architecture");
  assert.ok(closed.explicitlyForbidden.includes("phase1b-implementation"));
  assert.ok(closed.explicitlyForbidden.includes("deployAuthorized=true"));
  assert.ok(
    matrix.roles.every((role) => role.decision === "accepted"),
    "all seven role rows must remain accepted",
  );
});
