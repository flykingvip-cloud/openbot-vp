import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const REPO = path.resolve(DIR, "../../..");
const PACKET = "memory-workspace-phase1b-item7-w5-index-last.json";
const CURRENT = "memory-workspace-phase1b-unlock-current.json";
const CANONICAL = "memory-workspace-phase1b-unlock-decision.json";
const W4_MERGE = "931d1287e97096d64da7d9852962953346e63446";
const HANDOFF = "docs/design/evidence/memory-workspace-phase1b-item7-w5-index-last-handoff.md";
const RUNTIME = "src/memory/item7-w5-index-last.ts";

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function gitOut(args) {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

void test("Item 7 W5 packet proves index identity and does not mark met", () => {
  const packet = load(PACKET);
  const current = load(CURRENT);
  const canonical = load(CANONICAL);
  assert.equal(packet.wave, "W5");
  assert.equal(packet.siteCount, 8);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.item7Met, false);
  assert.equal(packet.thisPacketMarksItem7Met, false);
  assert.equal(packet.thisPacketDeletesCallSites, false);
  assert.equal(packet.catalogMissDeny, false);
  assert.equal(packet.indexSwitch, "denied");
  assert.equal(packet.liveWriteWatchIndex, 37);
  assert.equal(current.item7ImplementationUnlocked, true);
  assert.equal(canonical.unlock, "not-issued");
  assert.equal(canonical.items["7"], "not-met");
  assert.equal(packet.w4Merge, W4_MERGE);
  assert.equal(gitOk(["merge-base", "--is-ancestor", W4_MERGE, "HEAD"]), true);
  assert.equal(fs.existsSync(path.join(REPO, RUNTIME)), true);
  assert.equal(gitOut(["diff", "--name-only", "origin/main", "--", "src/memory/schema-v2.ts"]), "");
});

void test("Item 7 W5 handoff keeps index switch and met blocked", () => {
  const handoff = fs.readFileSync(path.join(REPO, HANDOFF), "utf8");
  assert.match(handoff, /W5 memory index/);
  assert.match(handoff, /not-met/);
  assert.match(handoff, /indexSwitch\s+\|\s+denied/);
  assert.doesNotMatch(handoff, /phase1bExecutionBlocked=false/);
});
