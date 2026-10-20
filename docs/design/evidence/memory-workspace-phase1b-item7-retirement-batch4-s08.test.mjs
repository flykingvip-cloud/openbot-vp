import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch4-s08.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const sourcePath = path.join(
  root,
  "src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable.ts",
);
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
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

void test("item 7 batch 4 retires S08 and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const source = fs.readFileSync(sourcePath, "utf8");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.remaining, 25);
  assert.equal(packet.liveWriteWatchIndex, 25);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.ok(scan.remaining <= 25);
  assert.ok(scan.sites.length <= 25);
  assert.equal(scan.sites.length, scan.liveWriteWatchIndex);
  assert.equal(scan.liveWriteWatchIndex, scan.remaining);
  assert.ok(scan.liveWriteWatchIndex <= 25);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.deleteCallSites, false);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(
    scan.sites.some(
      (site) =>
        site.file ===
          "src/gateway/knowledge/deliverables/maybe-auto-capture-agent-deliverable.ts" &&
        site.symbol === "createEmptyWorkspaceCatalog",
    ),
    false,
  );
  assert.match(source, /resolveWorkspaceLocator/);
  assert.doesNotMatch(source, /createEmptyWorkspaceCatalog/);
  assert.equal(packet.rollback.rewriteFreezeBaselineToZero, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
