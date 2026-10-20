import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch4-s06.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const storePath = path.join(root, "src/gateway/checkpoint-store.ts");
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const BASELINE = "7df232309134f75751be39fff42f32be8fcfac3c";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 4 retires S06 and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const store = fs.readFileSync(storePath, "utf8");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.remaining, 25);
  assert.equal(packet.liveWriteWatchIndex, 25);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.ok(scan.remaining <= 25);
  assert.ok(scan.sites.length <= 25);
  assert.ok(scan.liveWriteWatchIndex <= 25);
  assert.equal(scan.sites.length, scan.liveWriteWatchIndex);
  assert.equal(
    scan.sites.some(
      (site) =>
        site.file === "src/gateway/checkpoint-store.ts" &&
        site.symbol === "resolveEmployeeBuiltinStewardWorkspaceDir",
    ),
    false,
  );
  assert.match(store, /steward:builtin/);
  assert.match(store, /resolveWorkspaceLocator/);
  assert.doesNotMatch(store, /resolveEmployeeBuiltinStewardWorkspaceDir/);
  assert.doesNotMatch(store, /createEmptyWorkspaceCatalog/);
  assert.doesNotMatch(store, /resolveWorkspaceResource/);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.rollback.rewriteFreezeBaselineToZero, false);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
