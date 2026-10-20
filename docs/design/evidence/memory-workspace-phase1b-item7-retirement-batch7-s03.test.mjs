import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch7-s03.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const agentPath = path.join(root, "src/commands/agent.ts");
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const BASELINE = "e1cbc1e80420782e8d3720a546ebc39d9d06764b";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 7 retires S03 and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const agent = fs.readFileSync(agentPath, "utf8");
  const agentLines = agent.split(/\n/);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.remaining, 30);
  assert.equal(packet.liveWriteWatchIndex, 30);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.ok(scan.remaining <= 30);
  assert.ok(scan.sites.length <= 30);
  assert.equal(scan.sites.length, scan.liveWriteWatchIndex);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(
    scan.sites.some(
      (site) =>
        site.file === "src/commands/agent.ts" &&
        site.symbol === "resolveAgentWorkspaceDirForClient",
    ),
    false,
  );
  assert.equal(agentLines[775].includes("resolveWorkspaceLocator"), true);
  assert.equal(agentLines[778].includes("resolveAgentWorkspaceDir"), true);
  assert.equal(agentLines[783].includes("resolveAgentWorkspaceDir"), true);
  assert.doesNotMatch(agent, /resolveAgentWorkspaceDirForClient/);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.independentRetirementReviewAccepted, true);
  assert.equal(packet.rollback.rewriteFreezeBaselineToZero, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.live, "forbidden");
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(unlock.item7RetirementUnlocked, true);
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
