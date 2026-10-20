import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch2-s05.json",
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
const BASELINE = "2e09b95e73762d42f925f9d15a9ab73c115d173e";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 2 retires S05 and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const store = fs.readFileSync(storePath, "utf8");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.remaining, 35);
  assert.equal(packet.liveWriteWatchIndex, 35);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.ok(scan.remaining <= 35);
  assert.ok(scan.sites.length <= 35);
  assert.equal(scan.sites.length, scan.liveWriteWatchIndex);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(
    scan.sites.some(
      (site) =>
        site.file === "src/gateway/checkpoint-store.ts" &&
        site.symbol === "resolveAgentWorkspaceDir",
    ),
    false,
  );
  assert.match(store, /resolveWorkspaceLocator/);
  assert.doesNotMatch(store, /resolveAgentWorkspaceDir\(/);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.rollback.rewriteFreezeBaselineToZero, false);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
