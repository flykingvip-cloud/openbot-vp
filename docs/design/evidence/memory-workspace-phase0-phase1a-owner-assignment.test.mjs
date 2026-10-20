import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const EVIDENCE_DIR = path.dirname(import.meta.filename);

void test("phase1a owner assignment: all seven roles have unique owners", () => {
  const doc = JSON.parse(
    fs.readFileSync(
      path.join(EVIDENCE_DIR, "memory-workspace-phase0-phase1a-owner-assignment.json"),
      "utf8",
    ),
  );
  assert.equal(doc.phase0Closed, true);
  assert.equal(doc.assignments.length, 7);
  const owners = doc.assignments.map((a) => a.owner);
  assert.ok(owners.every((o) => o !== "unassigned"));
  assert.ok(doc.assignments.every((a) => a.status === "accepted-design-gate"));
  assert.ok(!doc.stillBlocked.some((b) => b.id === "section141-unsigned"));
  assert.ok(doc.stillBlocked.some((b) => b.id === "phase1b-execution"));
  assert.ok(!doc.stillBlocked.some((b) => b.id === "ws-b-change-request-unaccepted"));
  assert.ok(doc.forbidden.includes("phase1b-implementation"));
  assert.ok(doc.forbidden.includes("deployAuthorized=true"));
});

void test("ws-b dispatch targets cursor-data-governance with phase0 closed", () => {
  const doc = JSON.parse(
    fs.readFileSync(path.join(EVIDENCE_DIR, "memory-workspace-phase0-ws-b-dispatch.json"), "utf8"),
  );
  assert.equal(doc.to, "cursor-data-governance");
  assert.equal(doc.status, "accepted");
  assert.equal(doc.phase0Status.phase0Accepted, true);
  assert.equal(doc.phase0Status.reviewSequence, 25);
  assert.ok(doc.explicitlyOutOfScope.includes("Resolver production write switch"));
  assert.equal(
    doc.failClosedEvidence,
    "docs/design/evidence/memory-workspace-phase1a-ws-b-unknown-conflict-failclosed.json",
  );
});

void test("section141 matrix: no unassigned owners after phase1a prep", () => {
  const matrix = JSON.parse(
    fs.readFileSync(
      path.join(EVIDENCE_DIR, "memory-workspace-phase0-section141-signoff-matrix.json"),
      "utf8",
    ),
  );
  assert.equal(matrix.phase0Accepted, true);
  assert.equal(matrix.section141Signed, true);
  assert.equal(matrix.section141SignedBy, "cursor-memory-platform");
  assert.equal(typeof matrix.section141SignedAt, "string");
  assert.equal(matrix.phase1bExecutionBlocked, true);
  assert.equal(matrix.roles.length, 7);
  assert.ok(matrix.roles.every((r) => r.owner !== "unassigned"));
  assert.ok(matrix.roles.every((r) => r.decision === "accepted"));
  assert.equal(matrix.workstreamOwners["WS-A"].status, "contracts-accepted");
  assert.equal(matrix.workstreamOwners["WS-D"].owner, "cursor-fable");
  assert.equal(matrix.workstreamOwners["WS-D"].status, "matrix-accepted");
  assert.equal(matrix.workstreamOwners["WS-B"].status, "change-request-accepted");
  assert.equal(
    matrix.workstreamOwners["WS-B"].failClosedEvidence,
    "docs/design/evidence/memory-workspace-phase1a-ws-b-unknown-conflict-failclosed.json",
  );
  assert.equal(matrix.signedCount, 7);
  assert.equal(
    matrix.signedCount,
    matrix.roles.filter((role) => role.decision === "accepted").length,
  );
  assert.ok(matrix.forbiddenUntilComplete.includes("phase1b-implementation"));
  assert.ok(matrix.forbiddenUntilComplete.includes("deployAuthorized=true"));
});
