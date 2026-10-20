import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-batch15-s09.json",
);
const scanPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
);
const previewPath = path.join(root, "src/gateway/knowledge/knowledge-document-preview.ts");
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const BASELINE = "697c65c905c624ec80aba2a3386a00a7d0cc818a";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("item 7 batch 15 retires S09 and keeps remaining above zero", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  const source = fs.readFileSync(previewPath, "utf8");
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.remaining, 19);
  assert.equal(packet.liveWriteWatchIndex, 19);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.ok(scan.remaining <= 19);
  assert.ok(scan.sites.length <= 19);
  assert.equal(scan.liveWriteWatchIndex, scan.remaining);
  assert.notEqual(scan.liveWriteWatchIndex, 0);
  assert.equal(
    scan.sites.some(
      (site) =>
        site.file === "src/gateway/knowledge/knowledge-document-preview.ts" &&
        site.symbol === "createEmptyWorkspaceCatalog",
    ),
    false,
  );
  assert.doesNotMatch(source, /createEmptyWorkspaceCatalog/);
  assert.match(source, /InMemoryWorkspaceResourceCatalog/);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.productionWrite, false);
  assert.equal(packet.rollbackProof, true);
  assert.equal(packet.quarantineProof, true);
  assert.equal(packet.independentRetirementReviewAccepted, true);
  assert.equal(packet.rollback.rewriteFreezeBaselineToZero, false);
  assert.equal(packet.retirementExecuted, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.live, "forbidden");
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  assert.equal(unlock.retirementExecuted, false);
  assert.equal(unlock.item7RetirementUnlocked, true);
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(gitOk(["merge-base", "--is-ancestor", BASELINE, "HEAD"]), true);
});
