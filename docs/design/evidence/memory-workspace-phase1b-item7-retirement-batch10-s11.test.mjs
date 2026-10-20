import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch10-s11.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const agentsPath = path.join(root, "src/gateway/server-methods/agents.ts");
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const BASELINE = "fa540c56750233def1c27aafdbf8255db644257b";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 10 retires S11 and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const agents = fs.readFileSync(agentsPath, "utf8");
  const agentsLines = agents.split(/\n/);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.remaining, 27);
  assert.equal(packet.liveWriteWatchIndex, 27);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.ok(scan.remaining <= 27);
  assert.ok(scan.sites.length <= 27);
  assert.equal(scan.sites.length, scan.liveWriteWatchIndex);
  assert.equal(scan.liveWriteWatchIndex, scan.remaining);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(
    scan.sites.some(
      (site) => site.file === "src/gateway/server-methods/agents.ts" && site.line === 146,
    ),
    false,
  );
  assert.equal(agentsLines[142].includes("resolveWorkspaceLocator"), true);
  assert.equal(agentsLines[145].includes("resolveWorkspaceLocator"), true);
  assert.equal(agentsLines[145].includes('""'), true);
  assert.equal(agentsLines[145].includes("resolveAgentWorkspaceDir"), false);
  assert.equal(agentsLines[1000].includes("resolveWorkspaceLocator"), true);
  assert.equal(agentsLines[1074].includes("resolveWorkspaceLocator"), true);
  assert.equal(agentsLines[1158].includes("resolveWorkspaceLocator"), true);
  assert.equal(agentsLines[1159].includes("resolveAgentWorkspaceDir"), true);
  assert.doesNotMatch(agents, /resolveAgentWorkspaceDirForClient/);
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
