import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("cursor-sot-reviewer issues U1-dark-only unlock without Phase 1B or LIVE", () => {
  const unlock = load("openbot-cogniweave-u1-unlock-decision.json");
  const phase1b = load("memory-workspace-phase1b-unlock-decision.json");
  const scorecard = load("memory-workspace-phase1b-items-2-7-scorecard.json");
  const request = load("openbot-cogniweave-u1-design-review-request-2026-08-19.json");
  const architecture = load(
    "openbot-cogniweave-u1-design-review-codex-workspace-architecture.json",
  );
  const dg = load("openbot-cogniweave-u1-design-review-cursor-data-governance.json");
  const wsc = load("openbot-cogniweave-u1-design-review-cursor-memory-wsc.json");
  const lifecycle = load("openbot-cogniweave-u1-design-review-cursor-conversation-lifecycle.json");
  const item6 = load("openbot-cogniweave-u1-item6-production-equivalent-receipt.json");
  const schema = fs.readFileSync(path.join(REPO, "src/memory/schema-v2.ts"), "utf8");
  const packed = JSON.stringify(unlock);

  assert.equal(unlock.signedBy, "cursor-sot-reviewer");
  assert.equal(unlock.reviewedBy, "cursor-sot-reviewer");
  assert.notEqual(unlock.signedBy, "cursor-unified-memory-u1-admission");
  assert.notEqual(unlock.signedBy, "cursor-fable");
  assert.notEqual(unlock.signedBy, "cursor-memory-wsc");
  assert.equal(unlock.unlock, "issued");
  assert.equal(unlock.decision, "accepted");
  assert.equal(unlock.authorizes, "U1-dark-integration-only");
  assert.equal(unlock.u1, "authorized-dark-only");
  assert.equal(unlock.implementationStarted, false);
  assert.ok(unlock.issuedAt);
  assert.equal(unlock.items["2"], "met");
  assert.equal(unlock.items["6"], "met");
  assert.equal(unlock.items["7"], "not-met");
  assert.equal(unlock.designReviews, "sidecars-accepted");
  assert.equal(unlock.coordinatorSlotsFilled, false);
  assert.equal(unlock.phase1bUnlock, "not-issued");
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.deployAuthorized, false);
  assert.equal(unlock.live, "forbidden");
  assert.equal(unlock.schemaV2Write, "disabled");
  assert.equal(unlock.productionCatalogWrite, "none");
  assert.ok(unlock.doesNotAuthorize.includes("LIVE"));
  assert.ok(unlock.doesNotAuthorize.includes("phase1bExecutionBlocked=false"));
  assert.ok(unlock.doesNotAuthorize.includes("fill coordinator request signedBy slots"));
  assert.ok(!unlock.doesNotAuthorize.includes("U1 Handle dark integration"));
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /\/root\//);
  assert.doesNotMatch(packed, /bot-2\.sqlite/);

  assert.equal(phase1b.unlock, "not-issued");
  assert.equal(phase1b.signedBy, null);
  assert.equal(phase1b.phase1bExecutionBlocked, true);
  assert.equal(phase1b.deployAuthorized, false);
  assert.equal(scorecard.unlock, "not-issued");
  assert.equal(scorecard.items.find((item) => item.id === 2).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 6).status, "met");
  assert.equal(item6.item6Candidate, "met");

  const sidecars = [architecture, dg, wsc, lifecycle];
  assert.ok(sidecars.every((row) => row.decision === "accepted"));
  assert.equal(new Set(sidecars.map((row) => row.signedBy)).size, 4);
  assert.ok(
    request.requiredIndependentReviews.every(
      (row) => row.signedBy === null && row.decision === "pending",
    ),
  );
  assert.equal(request.status, "pending");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
});

void test("issued U1 unlock does not start Handle wiring or schema v2 write", () => {
  const unlock = load("openbot-cogniweave-u1-unlock-decision.json");
  const manager = fs.readFileSync(path.join(REPO, "src/memory/cogniweave-manager.ts"), "utf8");
  const schema = fs.readFileSync(path.join(REPO, "src/memory/schema-v2.ts"), "utf8");
  const registry = fs.readFileSync(path.join(REPO, ".loom/registry.yaml"), "utf8");

  assert.equal(unlock.implementationStarted, false);
  assert.match(manager, /stableId\("ws"/);
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.ok(
    registry.includes("openbot-cogniweave-unified-memory-remediation:cursor-sot-reviewer-u1"),
  );
});
