import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const EVIDENCE_DIR = path.dirname(import.meta.filename);

void test("official-review-25 independent verification: five checks PASS, signed at review-25", () => {
  const doc = JSON.parse(
    fs.readFileSync(
      path.join(
        EVIDENCE_DIR,
        "memory-workspace-phase0-official-review-25-independent-verification.json",
      ),
      "utf8",
    ),
  );
  assert.equal(doc.verdict, "PASS");
  assert.equal(doc.governance.phase0Accepted, true);
  assert.equal(doc.governance.deployAuthorized, false);
  assert.equal(doc.checks.length, 5);
  assert.ok(doc.checks.every((c) => c.result === "PASS"));
  assert.match(doc.mainSha, /^[0-9a-f]{40}$/);
  assert.equal(doc.offlineVerifierCrossCheck.result, "PASS");
});
