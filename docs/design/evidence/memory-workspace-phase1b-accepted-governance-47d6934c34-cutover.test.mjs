import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packetPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-accepted-governance-47d6934c34-cutover.json",
);
const decisionPath = path.join(
  root,
  "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
);
const CANDIDATE = "47d6934c34dced654652f027f2c66fedea35a67f";
const LIVE_BEFORE = "33993e52e5540f76e57d66ab75d8955420437d3a";

function gitOk(args) {
  try {
    execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

void test("accepted governance overlay stays locked after 47d6934c34 cutover", () => {
  const packet = JSON.parse(fs.readFileSync(packetPath, "utf8"));
  const decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
  assert.equal(packet.item7, "not-met");
  assert.equal(packet.phase1bExecutionBlocked, true);
  assert.equal(packet.phase1bUnlock, "not-issued");
  assert.equal(packet.deployAuthorized, false);
  assert.equal(packet.live, "forbidden");
  assert.equal(packet.productionCatalogWrite, "none");
  assert.equal(packet.schemaV2ProductionWrite, false);
  assert.equal(packet.catalogMutated, false);
  assert.equal(packet.containerRecreated, false);
  assert.equal(packet.inboundCscChanged, false);
  assert.equal(packet.candidateSha, CANDIDATE);
  assert.equal(packet.buildInfoSha, CANDIDATE);
  assert.equal(packet.oldLiveSha, LIVE_BEFORE);
  assert.equal(packet.forwardOnly, true);
  assert.equal(packet.provenanceTag, "provenance/sha-47d6934c34");
  assert.equal(packet.smoke.healthz, "live");
  assert.equal(packet.smoke.readyz, "ready");
  assert.equal(decision.phase1bExecutionBlocked, true);
  assert.equal(decision.items["7"], "not-met");
  assert.equal(gitOk(["merge-base", "--is-ancestor", LIVE_BEFORE, CANDIDATE]), true);
});
