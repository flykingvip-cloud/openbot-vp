import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { classifyAuthorizedSqlitePath } from "./openbot-cogniweave-u1-item6-production-equivalent-drill.mjs";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item6-implementation-progress.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const ITEM6_REVIEW_TIP = "d650a3fafa59192bef7823357d74eeca648e6ecf";
const ITEM7_REVIEW_TIP = "daa00a3d7006f2b7023f2540f276bc831f538317";
const UNLOCK_MERGE = "d3fd0f62cd9d979a07e0a64366127d62088485a2";
const BASELINE = "e0d5c3750166692bbcdd324854ee65e4a358a9f1";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item6-restricted-implementation.md";
const AUTH = "OPENBOT_AUTHORIZED_SQLITE_PATH";

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function readRepo(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), "utf8");
}

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 6 restricted implementation progress stays not-met", () => {
  const packet = load(PACKET);
  assert.equal(packet.status, "implementation-in-progress");
  assert.equal(packet.itemMet, false);
  assert.equal(packet.item6Met, false);
  assert.equal(packet.implementationUnlocked, true);
  assert.equal(packet.implementationStarted, true);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.wiredToProductionResolver, false);
  assert.equal(packet.liveCutover, false);
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.productionSqliteWrite, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(packet.authorizedSqlitePathRequired, true);
  assert.equal(packet.thisPacketMarksItem6Met, false);
  assert.equal(packet.baselineSha, BASELINE);
  assert.equal(packet.minimaReceiptTip, MINIMA_TIP);
  assert.equal(packet.item5ReviewTip, ITEM5_TIP);
  assert.equal(packet.item6ImplementationReviewPackageTip, ITEM6_REVIEW_TIP);
  assert.equal(packet.item7ImplementationReviewPackageTip, ITEM7_REVIEW_TIP);
  assert.equal(packet.item6ImplementationUnlockMerge, UNLOCK_MERGE);
  assert.equal(packet.i4DirtyTreeUsed, false);
  assert.ok(!REPO.includes(I4), REPO);
  assert.equal(fs.existsSync(path.join(REPO, packet.runtime)), true);
  assert.equal(fs.existsSync(path.join(REPO, HANDOFF)), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", MINIMA_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM5_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM6_REVIEW_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", ITEM7_REVIEW_TIP, "HEAD"]), true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", UNLOCK_MERGE, "HEAD"]), true);
  const schema = readRepo("src/memory/schema-v2.ts");
  assert.match(schema, /export const SCHEMA_V2_ENABLED = false/);
});

void test("item 6 path negative gates", () => {
  assert.equal(classifyAuthorizedSqlitePath({ [AUTH]: "" }).status, "unconfigured");
  assert.equal(
    classifyAuthorizedSqlitePath({
      [AUTH]: path.join(os.homedir(), ".openbot", "memory", "fixture.sqlite"),
    }).status,
    "missing-trusted-root",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({
      [AUTH]: path.join(DIR, "fixture.sqlite"),
    }).status,
    "missing-trusted-root",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({
      [AUTH]: path.join(os.tmpdir(), "openbot-item6-progress-fixture.sqlite"),
    }).status,
    "missing-trusted-root",
  );
  assert.equal(
    classifyAuthorizedSqlitePath({
      [AUTH]: path.join("/var/tmp", `openbot-item6-progress-${process.pid}`, "memory.sqlite"),
      OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT: path.join(
        "/var/tmp",
        `openbot-item6-progress-${process.pid}`,
      ),
    }).status,
    "rejected-fixture-path",
  );

  const trustedRoot = path.join(os.homedir(), `.item6-progress-trusted-${process.pid}`);
  fs.mkdirSync(trustedRoot, { recursive: true });
  const sqlitePath = path.join(trustedRoot, "memory.sqlite");
  const db = new DatabaseSync(sqlitePath);
  db.exec("CREATE TABLE item6_probe (id INTEGER PRIMARY KEY)");
  db.close();
  assert.equal(
    classifyAuthorizedSqlitePath({
      [AUTH]: sqlitePath,
      OPENBOT_AUTHORIZED_SQLITE_TRUSTED_ROOT: trustedRoot,
    }).status,
    "production-candidate",
  );
});

void test("item 6 restricted implementation handoff requests review only", () => {
  const handoff = readRepo(HANDOFF);
  assert.match(handoff, /Item 6 Restricted Implementation Review only/);
  assert.match(handoff, /does not request Item 6\/7 met/i);
  assert.match(handoff, /does not execute production writes/i);
  assert.match(handoff, /does not execute Retirement/i);
  assert.match(handoff, /does not delete old call-sites/i);
  assert.match(handoff, /does not switch the resolver/i);
  assert.match(handoff, /does not execute LIVE cutover/i);
});
