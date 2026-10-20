import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HOST = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("official item 2 is scored met from closeout plus architecture accept", () => {
  const score = read("memory-workspace-phase1b-item2-production-sot-score.json");
  const closeout = read("memory-workspace-phase1b-item2-production-closeout.json");
  const accept = read("memory-workspace-phase1b-item2-production-sot-architecture-accept.json");
  const coverage = read("memory-workspace-phase1b-item2-production-catalog-coverage.json");
  const scorecard = read("memory-workspace-phase1b-items-2-7-scorecard.json");
  const phase1bUnlock = read("memory-workspace-phase1b-unlock-decision.json");
  const u1Unlock = read("openbot-cogniweave-u1-unlock-decision.json");
  const schema = fs.readFileSync(path.join(REPO, "src/memory/schema-v2.ts"), "utf8");
  const raw = JSON.stringify(score);

  assert.equal(score.item2, "met");
  assert.equal(score.item2Official, "met");
  assert.equal(score.signedBy, "cursor-data-governance");
  assert.notEqual(score.signedBy, "codex-workspace-architecture");
  assert.equal(score.uniqueUserOwnedEquivalent, closeout.uniqueUserOwnedEquivalent);
  assert.equal(score.uniqueUserOwnedEquivalent, 7);
  assert.equal(score.fourGates100, true);
  assert.equal(score.fourGatePopulation, "authority-shaped");
  assert.equal(score.productionCatalogWrite, "none");
  assert.equal(score.unlock, "not-issued");
  assert.equal(score.u1, "blocked");
  assert.equal(score.occupancyRunnerItem2, "not-met");
  assert.equal(coverage.item2, "not-met");
  assert.equal(coverage.uniqueUserOwnedEquivalent, 0);
  assert.equal(accept.item2RulesAccepted, true);
  assert.equal(scorecard.items.find((item) => item.id === 2).status, "met");
  assert.equal(scorecard.items.find((item) => item.id === 6).status, "met");
  assert.equal(phase1bUnlock.items["2"], "met");
  assert.equal(phase1bUnlock.unlock, "not-issued");
  assert.equal(u1Unlock.unlock, "issued");
  assert.equal(u1Unlock.signedBy, "cursor-sot-reviewer");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.ok(score.doesNotAuthorize.includes("unlock"));
  assert.ok(!UUID.test(raw));
  assert.ok(!HOST.test(raw));
});

void test("remaining U1 dark-contract sidecars accept without filling coordinator slots", () => {
  const request = read("openbot-cogniweave-u1-design-review-request-2026-08-19.json");
  const dg = read("openbot-cogniweave-u1-design-review-cursor-data-governance.json");
  const wsc = read("openbot-cogniweave-u1-design-review-cursor-memory-wsc.json");
  const lifecycle = read("openbot-cogniweave-u1-design-review-cursor-conversation-lifecycle.json");
  const architecture = read(
    "openbot-cogniweave-u1-design-review-codex-workspace-architecture.json",
  );
  const u1Unlock = read("openbot-cogniweave-u1-unlock-decision.json");

  const sidecars = [architecture, dg, wsc, lifecycle];
  assert.deepEqual(
    sidecars.map((row) => row.signedBy),
    [
      "codex-workspace-architecture",
      "cursor-data-governance",
      "cursor-memory-wsc",
      "cursor-conversation-lifecycle",
    ],
  );
  assert.ok(sidecars.every((row) => row.decision === "accepted"));
  assert.ok(sidecars.every((row) => row.scope === "U1-dark-contract-only"));
  assert.ok(sidecars.every((row) => row.unlock === "not-issued"));
  assert.ok(sidecars.every((row) => row.u1 === "blocked"));
  assert.ok(sidecars.every((row) => row.authorizes === "none"));
  assert.equal(new Set(sidecars.map((row) => row.signedBy)).size, 4);

  assert.ok(
    request.requiredIndependentReviews.every(
      (row) => row.signedBy === null && row.decision === "pending",
    ),
  );
  assert.equal(request.status, "pending");
  assert.equal(u1Unlock.unlock, "issued");
  assert.equal(u1Unlock.signedBy, "cursor-sot-reviewer");
  assert.equal(wsc.verified.SCHEMA_V2_ENABLED, false);
  assert.equal(wsc.verified.item7RetiredThisChange, 0);
  assert.equal(lifecycle.verified.u1ImplementationStarted, false);
  assert.equal(dg.item2, "met");
  assert.equal(dg.item6, "not-met");
});
