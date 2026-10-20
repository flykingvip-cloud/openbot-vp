import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-item6-restricted-accepted.json",
);
const handoffPath = path.join(
  root,
  ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-item6-restricted-accepted.md",
);
const unlockPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-current.json",
);

void test("item 6 restricted implementation submitted for review only", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const handoff = fs.readFileSync(handoffPath, "utf8");
  const unlock = JSON.parse(fs.readFileSync(unlockPath, "utf8"));
  assert.equal(packet.status, "submitted-for-review");
  assert.equal(packet.item6RestrictedImplementation, "submitted-for-review");
  assert.equal(packet.item6Met, false);
  assert.equal(packet.item6, "not-met");
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.wiredToProductionResolver, false);
  assert.equal(packet.liveCutover, false);
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.productionSqliteWrite, false);
  assert.equal(packet.thisPacketMarksItem6Met, false);
  assert.match(handoff, /submitted for review/i);
  assert.match(handoff, /not-issued/);
  assert.match(handoff, /Item 6 Restricted Implementation \| \*\*submitted for review\*\*/);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.fullUnlock, "not-issued");
  for (const rel of packet.runtimeModules) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
  }
  for (const rel of packet.directedTests) {
    assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
  }
});
