import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const DIR = path.dirname(import.meta.filename);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const FILES = [
  "memory-workspace-phase1b-item5-production-closeout.json",
  "memory-workspace-phase1b-item5-production-live-caller.json",
  "memory-workspace-phase1b-item5-production-registry-catalog.json",
  "memory-workspace-phase1b-item5-production-tenant-context.json",
  "memory-workspace-phase1b-item5-production-evidence-summary.json",
];

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([key]) => key !== "evidenceDigests")
      .toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

void test("item 5 production closeout stays a review packet and keeps field semantics consistent", () => {
  const closeout = read("memory-workspace-phase1b-item5-production-closeout.json");
  const live = read("memory-workspace-phase1b-item5-production-live-caller.json");
  const registry = read("memory-workspace-phase1b-item5-production-registry-catalog.json");
  const tenant = read("memory-workspace-phase1b-item5-production-tenant-context.json");
  const summary = read("memory-workspace-phase1b-item5-production-evidence-summary.json");
  const packets = [closeout, live, registry, tenant, summary];
  const unlock = read("memory-workspace-phase1b-unlock-decision.json");

  for (const packet of packets) {
    assert.equal(packet.item5Met, false);
    assert.equal(packet.wiredToProductionResolver, false);
    assert.equal(packet.baselineSha, closeout.baselineSha);
    assert.equal(packet.operationId, closeout.operationId);
    assert.equal(packet.evidenceId, closeout.evidenceId);
    assert.equal(packet.stateDir, "/root/.openbot");
    assert.equal(packet.productionHostLogical, "production-gateway-host");
    assert.equal(packet.sourceKind, "production-gateway-host");
    assert.equal(packet.item6, "not-met");
    assert.equal(packet.item7, "not-met");
    assert.equal(packet.unlock, "not-issued");
    assert.equal(packet.deployAuthorized, false);
    assert.equal(packet.productionCatalogWrite, "compareAndPut");
    assert.notEqual(packet.catalogWriteThisPacket, "none");
    assert.ok(packet.measurementAt);
    assert.ok(!UUID.test(JSON.stringify(packet)));
    assert.ok(!JSON.stringify(packet).includes("@"));
  }

  assert.equal(closeout.decision, "submitted-for-independent-closeout-review");
  assert.equal(closeout.item5, "not-met");
  assert.equal(closeout.item6Unlocked, false);
  assert.equal(closeout.item7Unlocked, false);
  assert.equal(closeout.handoff.item5, "Item 5 submitted for closeout review");
  assert.equal(closeout.handoff.item5Met, false);
  assert.equal(closeout.handoff.schemaV2ProductionWrite, false);
  assert.equal(closeout.handoff.deleteOldWriteSites, false);
  assert.equal(typeof closeout.runtimeAlignedToBaseline, "boolean");
  assert.equal(closeout.containerRead.checksumMatch, true);
  assert.equal(closeout.main.active, true);
  assert.equal(closeout.main.membershipPrimaryBinding, true);
  assert.ok(closeout.backup.path);
  assert.ok(closeout.restart.at);
  assert.equal(closeout.restart.catalogUnchangedAcrossRestart, true);
  assert.equal(closeout.productionWrite.status, "executed");
  assert.equal(closeout.productionWrite.wiredToProductionResolver, false);
  assert.ok(closeout.productionWrite.persisted >= 0);
  assert.match(closeout.operationId, /^item5-closeout-[0-9a-f]{10,12}-20\d{6}T\d{6}Z$/);

  const perUser = registry.measured.perUser;
  const diagnostic = perUser.filter(
    (row) => row.missReason === "registry_resolved_asset_not_in_catalog",
  );
  const inCatalogFalse = perUser.filter((row) => row.registryResolvedInCatalog === false);
  const liveHit = perUser.filter((row) => row.missReason === "live_hit");
  const registryHits = live.measured.perUser.filter(
    (row) => row.liveHitKind === "registry_catalog_resolve",
  );
  const uniqueHits = live.measured.perUser.filter(
    (row) => row.liveHitKind === "unique_user_owned_row",
  );
  const membershipHits = live.measured.perUser.filter(
    (row) => row.liveHitKind === "membership_fallback",
  );

  assert.equal(registry.measured.usersWithRegistryResolvedNotInCatalog, diagnostic.length);
  assert.equal(registry.measured.perUserRegistryResolvedInCatalogFalse, inCatalogFalse.length);
  assert.equal(registry.measured.liveCallerHits, liveHit.length);
  assert.equal(live.measured.liveCallerHits, uniqueHits.length + registryHits.length);
  assert.equal(live.measured.registryCatalogResolveHits, registryHits.length);
  assert.equal(live.measured.membershipFallbackHits, membershipHits.length);
  assert.equal(tenant.measured.mainPathMisses, 0);
  assert.equal(tenant.measured.mainPathMembershipFallbacks, 0);
  assert.equal(summary.totals.usersWithRegistryResolvedNotInCatalog, diagnostic.length);
  assert.equal(summary.totals.fallbackHits, 0);
  assert.equal(summary.totals.oldRootFallback, 0);
  assert.equal(live.measured.liveCallerMisses, 0);
  assert.equal(closeout.registryResolveKindForMain, "builtin-universal");
  assert.ok(inCatalogFalse.length !== diagnostic.length || inCatalogFalse.length === 0);

  const expectedDigests = Object.fromEntries(
    FILES.map((name) => [
      name,
      createHash("sha256")
        .update(canonicalJson(read(name)))
        .digest("hex"),
    ]),
  );
  for (const packet of packets) {
    assert.deepEqual(packet.evidenceDigests, expectedDigests);
  }

  assert.equal(unlock.unlock, "not-issued");
  assert.equal(unlock.deployAuthorized, false);
  assert.equal(unlock.phase1bExecutionBlocked, true);
  assert.equal(unlock.path, "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json");

  const revoke = read("memory-workspace-phase1b-unlock-issued-stamp-revoke.json");
  const superseded = read("memory-workspace-phase1b-unlock-decision-issued-superseded.json");
  const eligibility = read("memory-workspace-phase1b-item5-runtime-eligibility.json");
  assert.equal(revoke.unlock, "not-issued");
  assert.equal(revoke.decision, "revoke-issued-stamp");
  assert.equal(
    revoke.replacement,
    "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
  );
  assert.equal(revoke.item5Met, false);
  assert.equal(revoke.item6Unlocked, false);
  assert.equal(revoke.item7Unlocked, false);
  assert.equal(revoke.wiredToProductionResolver, false);
  assert.equal(revoke.phase1bExecutionBlocked, true);
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.stamp.unlock, "issued");
  assert.equal(superseded.notCanonical, true);
  assert.equal(
    closeout.unlockReceipt,
    "docs/design/evidence/memory-workspace-phase1b-unlock-decision.json",
  );
  assert.equal(
    closeout.unlockRevokeReceipt,
    "docs/design/evidence/memory-workspace-phase1b-unlock-issued-stamp-revoke.json",
  );
  assert.equal(
    closeout.runtimeEligibility,
    "docs/design/evidence/memory-workspace-phase1b-item5-runtime-eligibility.json",
  );
  assert.equal(eligibility.runtimeSha, closeout.runtimeSha);
  assert.equal(eligibility.baselineSha, closeout.baselineSha);
  assert.equal(eligibility.originMainAtPacket, closeout.originMainSha);
  assert.equal(eligibility.runtimeAlignedToBaseline, true);
  assert.equal(eligibility.runtimeIsAncestorOfOriginMain, true);
  assert.equal(eligibility.runtimeIsAncestorOfBaseline, true);
  assert.equal(eligibility.allowedLiveCandidate, true);
  assert.equal(eligibility.cutoverLive, false);
  assert.equal(eligibility.plan, "A");
  assert.equal(eligibility.overlayId, "item5-runtime-align-r1");
  assert.equal(eligibility.item5Met, false);
  assert.equal(eligibility.item6Unlocked, false);
  assert.equal(eligibility.item7Unlocked, false);
  assert.equal(eligibility.wiredToProductionResolver, false);
  assert.equal(closeout.runtimeAlignedToBaseline, true);
  assert.equal(closeout.runtimeSha, closeout.baselineSha);
  assert.equal(closeout.originMainSha, closeout.baselineSha);

  for (const packet of packets) {
    assert.equal(packet.unlockReceipt, closeout.unlockReceipt);
    assert.equal(packet.unlockRevokeReceipt, closeout.unlockRevokeReceipt);
    assert.equal(packet.runtimeEligibility, closeout.runtimeEligibility);
  }

  const tasks = fs.readFileSync(
    path.join(DIR, "../../../.kiro/specs/memory-workspace-platform-remediation/tasks.md"),
    "utf8",
  );
  assert.match(tasks, /Item 5 = \*\*submitted\/not-met\*\*/);
  assert.match(tasks, /Item 6\/7 = \*\*not-met\/locked\*\*/);
  assert.match(tasks, /wiredToProductionResolver=false/);
  assert.match(tasks, /Item 5 submitted for closeout review/);
  assert.match(tasks, new RegExp(closeout.operationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(tasks, /历史口径，已作废 \/ SUPERSEDED[\s\S]*item 5 = met/);
  assert.match(tasks, /codex-handoff-item5-final-closeout\.md/);

  const handoffPath = path.join(
    DIR,
    "../../../.kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-final-closeout.md",
  );
  assert.equal(fs.existsSync(handoffPath), true);
  const handoff = fs.readFileSync(handoffPath, "utf8");
  assert.match(handoff, /Item 5 Final Closeout Review/);
  assert.match(handoff, /item5Met/);
  assert.match(handoff, /false/);
  for (const name of FILES) {
    const fileSha = createHash("sha256")
      .update(fs.readFileSync(path.join(DIR, name)))
      .digest("hex");
    assert.ok(handoff.includes(fileSha), `final handoff must bind file sha256 of ${name}`);
    assert.ok(
      handoff.includes(expectedDigests[name]),
      `final handoff must bind canonical digest of ${name}`,
    );
  }

  const binding = read("memory-workspace-phase1b-item5-final-closeout-binding.json");
  assert.equal(binding.item5Met, false);
  assert.equal(binding.item6Unlocked, false);
  assert.equal(binding.item7Unlocked, false);
  assert.equal(binding.unlock, "not-issued");
  assert.equal(binding.wiredToProductionResolver, false);
  assert.equal(binding.runtimeAlignedToBaseline, true);
  assert.equal(binding.operationId, closeout.operationId);
  assert.equal(
    binding.handoff,
    ".kiro/specs/memory-workspace-platform-remediation/codex-handoff-item5-final-closeout.md",
  );
  for (const name of FILES) {
    const fileSha = createHash("sha256")
      .update(fs.readFileSync(path.join(DIR, name)))
      .digest("hex");
    assert.equal(binding.files[name].fileSha256, fileSha);
    assert.equal(binding.files[name].canonicalSha256, expectedDigests[name]);
  }
});
