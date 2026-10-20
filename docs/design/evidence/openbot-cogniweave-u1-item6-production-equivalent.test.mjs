import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyAuthorizedSqlitePath,
  measureProductionEquivalentDrill,
} from "./openbot-cogniweave-u1-item6-production-equivalent-drill.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

void test("item 6 production-equivalent receipt is met after an issued authorized path", () => {
  const receipt = load("openbot-cogniweave-u1-item6-production-equivalent-receipt.json");
  const sre = load("openbot-cogniweave-u1-item6-sre-review.json");
  const wsc = load("openbot-cogniweave-u1-item6-wsc-review.json");
  const layout = load("memory-workspace-phase1b-item6-cutover-drill-receipt.json");
  const packed = JSON.stringify(receipt);

  assert.equal(receipt.item6Candidate, "met");
  assert.equal(receipt.classification, "production-candidate");
  assert.match(String(receipt.pathToken), /^sha256:[0-9a-f]{16}$/);
  assert.equal(receipt.productionEquivalentSnapshot, true);
  assert.equal(receipt.backupNonEmpty, true);
  assert.equal(receipt.backupHashVerified, true);
  assert.equal(receipt.restoreProven, true);
  assert.equal(receipt.v1RootGuardDrilled, true);
  assert.equal(receipt.productionWrites, 0);
  assert.equal(receipt.operatorIssued, true);
  assert.equal(receipt.liveDocumentedSourceUnwritten, true);
  assert.equal(receipt.authorizedLayoutResourceSqlite, false);
  assert.equal(receipt.wscReview, "pending");
  assert.equal(receipt.sreReview, "accepted");
  assert.equal(receipt.live, "forbidden");
  assert.equal(receipt.unlock, "not-issued");
  assert.equal(layout.item6, "not-met");
  assert.equal(layout.status, "green");
  assert.doesNotMatch(packed, /\/Users\//);
  assert.doesNotMatch(packed, /\/root\//);
  assert.doesNotMatch(packed, /bot-2\.sqlite/);
  assert.ok(receipt.explicitlyForbidden.includes("treat mkdtemp fixture as production-equivalent"));

  assert.equal(sre.signedBy, "cursor-fable");
  assert.equal(sre.decision, "accepted");
  assert.equal(sre.item6Candidate, "met");
  assert.equal(sre.acceptsFailClosedNotMet, false);
  assert.equal(sre.productionWrites, 0);
  assert.equal(sre.confirmed.liveDocumentedSourceUnwritten, true);
  assert.ok(sre.explicitlyForbidden.includes("sign the WSC review as cursor-fable"));

  assert.equal(wsc.owner, "cursor-memory-wsc");
  assert.equal(wsc.decision, "pending");
  assert.equal(wsc.signedBy, null);
  assert.notEqual(wsc.signedBy, "cursor-fable");
  assert.notEqual(sre.signedBy, wsc.owner);
});

void test("classifier refuses evidence, host, and mkdtemp fixture paths", async () => {
  const evidence = path.join(DIR, "memory-workspace-phase1b-item6-cutover-drill-receipt.json");
  const host = path.join(os.homedir(), ".openbot", "memory", "fixture.sqlite");
  const tmp = path.join(os.tmpdir(), "openbot-item6-fixture.sqlite");

  assert.equal(
    classifyAuthorizedSqlitePath({ OPENBOT_AUTHORIZED_SQLITE_PATH: "" }).status,
    "unconfigured",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({
      OPENBOT_AUTHORIZED_SQLITE_PATH: evidence,
      OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT: DIR,
    }).status,
    "rejected-evidence-path",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({
      OPENBOT_AUTHORIZED_SQLITE_PATH: host,
      OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT: path.dirname(path.dirname(host)),
    }).status,
    "host-not-production-sot",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({
      OPENBOT_AUTHORIZED_SQLITE_PATH: tmp,
      OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT: os.tmpdir(),
    }).status,
    "rejected-fixture-path",
  );

  const fixture = await measureProductionEquivalentDrill({
    OPENBOT_AUTHORIZED_SQLITE_PATH: tmp,
    OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT: os.tmpdir(),
  });
  assert.equal(fixture.item6Candidate, "not-met");
  assert.equal(fixture.productionEquivalentSnapshot, false);
  assert.equal(fixture.classification, "rejected-fixture-path");
  assert.equal(fixture.sreReview, "accepted");
  assert.equal(fixture.wscReview, "pending");
  assert.match(String(fixture.pathToken), /^sha256:[0-9a-f]{16}$/);
});

void test("SRE packet does not rewrite U1 unlock or production guard files", () => {
  const unlock = load("openbot-cogniweave-u1-unlock-decision.json");
  const schema = fs.readFileSync(path.join(REPO, "src/memory/schema-v2.ts"), "utf8");
  const registry = fs.readFileSync(path.join(REPO, ".loom/registry.yaml"), "utf8");

  assert.equal(unlock.unlock, "issued");
  assert.equal(unlock.signedBy, "cursor-sot-reviewer");
  assert.equal(unlock.items["6"], "met");
  assert.notEqual(unlock.signedBy, "cursor-fable");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
  assert.ok(
    registry.includes("openbot-cogniweave-unified-memory-remediation:cursor-fable-item6-sre"),
  );
});
