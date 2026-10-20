import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packet = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "docs/design/evidence/memory-workspace-phase1b-item7-retirement-preflight-matrix.json",
    ),
    "utf8",
  ),
);
const matrixSrc = fs.readFileSync(
  path.join(root, "src/gateway/data-governance/item7-retirement-preflight-matrix.ts"),
  "utf8",
);

void test("preflight matrix keeps 37 classified sites and does not delete them", () => {
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.siteCount, 37);
  assert.equal(packet.liveWriteWatchIndex, 37);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.equal(packet.retiredThisChange, 0);
  assert.equal(packet.deleteCallSites, false);
  assert.equal(packet.sharedUserOwnedPassAfterFixture, false);
  assert.equal(packet.executeWorktree.doNotLand, true);
  assert.equal(packet.executeWorktree.commitDeletionCode, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.live, "forbidden");
  assert.match(matrixSrc, /ledgerId: "S01"/);
  assert.match(matrixSrc, /ledgerId: "S37"/);
  assert.match(matrixSrc, /workspaceKind: "group_owned"/);
  assert.match(matrixSrc, /workspaceKind: "position_owned"/);
  assert.match(matrixSrc, /workspaceKind: "employee_private"/);
});
