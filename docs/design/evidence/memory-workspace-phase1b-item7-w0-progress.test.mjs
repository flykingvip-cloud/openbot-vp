import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item7-w0-progress.json";
const MINIMA_TIP = "ce6cf5e1702c7f2de20b58f062fd100562b6ee01";
const ITEM5_TIP = "85f55ee2fa76f88dc538180b481a5823631af649";
const ITEM6_REVIEW_TIP = "d650a3fafa59192bef7823357d74eeca648e6ecf";
const ITEM7_REVIEW_TIP = "daa00a3d7006f2b7023f2540f276bc831f538317";
const UNLOCK_MERGE = "d3fd0f62cd9d979a07e0a64366127d62088485a2";
const BASELINE = "e0d5c3750166692bbcdd324854ee65e4a358a9f1";
const I4 = "openbot-data-governance-p4-later-i4-eval";
const HANDOFF =
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-phase1b-item7-w0-restricted-implementation.md";
const LEDGER = "memory-workspace-phase1b-item7-callsite-ledger.json";

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

void test("item 7 W0 progress stays not-met and does not retire sites", () => {
  const packet = load(PACKET);
  const ledger = load(LEDGER);
  assert.equal(packet.status, "implementation-in-progress");
  assert.equal(packet.wave, "W0");
  assert.equal(packet.itemMet, false);
  assert.equal(packet.item7Met, false);
  assert.equal(packet.implementationUnlocked, true);
  assert.equal(packet.implementationStarted, true);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.wiredToProductionResolver, false);
  assert.equal(packet.liveCutover, false);
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(packet.deleteCallSites, false);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.liveWriteWatchIndex, 37);
  assert.equal(packet.frozenWriteWatchIndex, 38);
  assert.equal(packet.catalogMissDeny, false);
  assert.equal(ledger.liveWriteWatchIndex, 37);
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
  const runtime = readRepo(packet.runtime);
  assert.match(runtime, /ITEM7_W0_DELETE_CALL_SITES = false/);
  assert.match(runtime, /ITEM7_W0_LIVE_WRITE_WATCH_INDEX = 37/);
  assert.doesNotMatch(runtime, /wiredToProductionResolver = true/);
});

void test("item 7 W0 handoff requests W0 Restricted Implementation Review only", () => {
  const handoff = readRepo(HANDOFF);
  assert.match(handoff, /Item 7 W0 Restricted Implementation Review only/);
  assert.match(handoff, /does not request Item 6\/7 met/i);
  assert.match(handoff, /does not execute production writes/i);
  assert.match(handoff, /does not execute Retirement/i);
  assert.match(handoff, /does not delete old call-sites/i);
  assert.match(handoff, /does not switch the resolver/i);
  assert.match(handoff, /does not execute LIVE cutover/i);
});
