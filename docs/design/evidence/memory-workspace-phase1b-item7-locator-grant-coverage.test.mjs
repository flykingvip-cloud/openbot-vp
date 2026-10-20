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
      "docs/design/evidence/memory-workspace-phase1b-item7-locator-grant-coverage.json",
    ),
    "utf8",
  ),
);
const locator = fs.readFileSync(
  path.join(root, "src/gateway/workspace-resolver/strict-locator.ts"),
  "utf8",
);

void test("locator grant coverage keeps locks and does not delete call-sites", () => {
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.retiredThisChange, 1);
  assert.equal(packet.liveWriteWatchIndex, 36);
  assert.notEqual(packet.liveWriteWatchIndex, 0);
  assert.equal(packet.deleteCallSites, false);
  assert.equal(packet.wiredToProductionResolver, false);
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2Write, "disabled");
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.grantModel.seatIdEqualsUserId, false);
  assert.equal(packet.grantModel.secondMembershipSot, false);
  assert.match(locator, /missing_membership_sot/);
  assert.match(locator, /source: "platform-auth"/);
  assert.match(locator, /if \(params.grant.kind === "seat"\)/);
  assert.match(locator, /if \(params.grant.kind === "group"\)/);
});
