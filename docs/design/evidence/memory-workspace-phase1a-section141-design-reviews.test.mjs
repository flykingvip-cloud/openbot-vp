import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const EVIDENCE_DIR = path.dirname(import.meta.filename);
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const DRAFT_REVIEWS = [];

const ARCHITECTURE_REVIEWS = [
  "memory-workspace-phase1a-section141-architecture-design-review.json",
  "memory-workspace-phase1a-section141-data-governance-design-review.json",
];

void test("phase1a section141 has no remaining draft design reviews", () => {
  assert.deepEqual(DRAFT_REVIEWS, []);
});

void test("phase1a section141 security review is accepted on main after #429", () => {
  const doc = JSON.parse(
    fs.readFileSync(
      path.join(EVIDENCE_DIR, "memory-workspace-phase1a-section141-security-design-review.json"),
      "utf8",
    ),
  );
  assert.equal(doc.decision, "accepted");
  assert.equal(doc.signedBy, "cursor-data-governance");
  assert.ok(doc.signedAt);
  assert.ok(doc.explicitlyForbidden.includes("deployAuthorized=true"));
});

void test("phase1a section141 architecture and data-governance reviews are accepted", () => {
  for (const file of ARCHITECTURE_REVIEWS) {
    const doc = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, file), "utf8"));
    assert.equal(doc.decision, "accepted");
    assert.equal(doc.signedBy, "codex-workspace-architecture");
    assert.equal(typeof doc.signedAt, "string");
    assert.match(doc.signedAt, ISO_8601);
    assert.ok(doc.explicitlyForbidden.includes("deployAuthorized=true"));
  }
});

void test("phase1a section141 memory and SRE reviews are accepted by cursor-memory-wsc", () => {
  for (const file of [
    "memory-workspace-phase1a-section141-memory-design-review.json",
    "memory-workspace-phase1a-section141-sre-design-review.json",
  ]) {
    const doc = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, file), "utf8"));
    assert.equal(doc.decision, "accepted");
    assert.equal(doc.signedBy, "cursor-memory-wsc");
    assert.equal(doc.owner, "cursor-memory-wsc");
    assert.equal(typeof doc.signedAt, "string");
    assert.match(doc.signedAt, ISO_8601);
    assert.ok(doc.explicitlyForbidden.includes("deployAuthorized=true"));
  }
});

void test("phase1a section141 wsd-cutover review is accepted by cursor-fable", () => {
  const doc = JSON.parse(
    fs.readFileSync(
      path.join(EVIDENCE_DIR, "memory-workspace-phase1a-section141-wsd-cutover-design-review.json"),
      "utf8",
    ),
  );
  assert.equal(doc.decision, "accepted");
  assert.equal(doc.signedBy, "cursor-fable");
  assert.equal(doc.owner, "cursor-fable");
  assert.equal(typeof doc.signedAt, "string");
  assert.match(doc.signedAt, ISO_8601);
  assert.ok(doc.explicitlyForbidden.includes("deployAuthorized=true"));
});
