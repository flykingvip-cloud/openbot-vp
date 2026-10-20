import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch5-s19.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const skillsPath = path.join(root, "src/gateway/server-methods/skills.ts");
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const BASELINE = "7cd74d4c5c69e7492eb6d624531f27592d6c809a";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 5 retires S19 and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const skills = fs.readFileSync(skillsPath, "utf8");
  const skillsLines = skills.split(/\n/);
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.remaining, 32);
  assert.equal(packet.liveWriteWatchIndex, 32);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.ok(scan.remaining <= 32);
  assert.ok(scan.sites.length <= 32);
  assert.equal(scan.sites.length, scan.liveWriteWatchIndex);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(
    scan.sites.some(
      (site) =>
        site.file === "src/gateway/server-methods/skills.ts" &&
        site.symbol === "resolveAgentWorkspaceDirForClient",
    ),
    false,
  );
  assert.equal(skillsLines[85].includes("resolveWorkspaceLocator"), true);
  assert.equal(skillsLines[86].includes("resolveAgentWorkspaceDir"), true);
  assert.equal(skillsLines[136].includes("resolveWorkspaceLocator"), true);
  assert.equal(skillsLines[137].includes("resolveAgentWorkspaceDir"), true);
  assert.doesNotMatch(skills, /resolveAgentWorkspaceDirForClient/);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.rollback.rewriteFreezeBaselineToZero, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(unlock.item7RetirementUnlocked, true);
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
