import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch1-s04.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const agentsPath = path.join(root, "src/commands/status-all/agents.ts");
const twinPath = path.join(root, "src/commands/status.agent-local.ts");
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);

void test("item 7 batch 1 retires S04 and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const agents = fs.readFileSync(agentsPath, "utf8");
  const twin = fs.readFileSync(twinPath, "utf8");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.remaining, 36);
  assert.equal(packet.liveWriteWatchIndex, 36);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.ok(scan.remaining <= 36);
  assert.ok(scan.sites.length <= 36);
  assert.equal(scan.sites.length, scan.liveWriteWatchIndex);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(
    scan.sites.some(
      (site) =>
        site.file === "src/commands/status-all/agents.ts" &&
        site.symbol === "resolveAgentWorkspaceDir",
    ),
    false,
  );
  assert.match(agents, /resolveWorkspaceLocator/);
  assert.doesNotMatch(agents, /resolveAgentWorkspaceDir/);
  assert.match(twin, /resolveWorkspaceLocator/);
  assert.doesNotMatch(twin, /resolveAgentWorkspaceDir/);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.rollback.rewriteFreezeBaselineToZero, false);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
});
