import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlacementPolicy } from "../gateway/data-governance/placement-resolve.js";
import {
  CUTOVER_PREP_LOCKS,
  cutoverPrepOperationId,
  evaluateS33S35CutoverPrep,
  S33_S35_CUTOVER_PREP,
  S33_S35_CUTOVER_ROLLBACK_MATRIX,
  S33_S35_LEGACY_LINES,
  S33_S35_OPERATION_MARKERS,
  S33_S35_RETIREMENT_DRAFT,
} from "./item7-stage-d-cutover-prep.js";
import { createLocalOnlyStagingAdapter } from "./item7-stage-d-local-adapter.js";
import {
  computeStageDManifest,
  FAIL_CLOSED_SYNC_ADAPTER,
  STAGE_D_SITES,
  syncMemoryAssets,
  type StageDDestinationPlacement,
  type StageDSourceFile,
  type StageDSyncAdapter,
  type SyncMemoryAssetsInput,
} from "./item7-stage-d-memory-sync.js";
import { createPersistentStageDStore } from "./item7-stage-d-persistent-store.js";
import {
  evaluateStageDProductionReadiness,
  STAGE_D_PHASE_E_GATES,
  type StageDReadinessGateSnapshot,
} from "./item7-stage-d-readiness.js";
import {
  canaryPhaseFor,
  runStageDLocalOnlyCanary,
  writeStageDCanaryReceipt,
} from "./item7-stage-d-shadow-canary.js";
import {
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
} from "./memory-workspace-handle.js";

const DARK_ON = { OPENBOT_ITEM7_W1_DARK_DUAL_READ: "1" } as NodeJS.ProcessEnv;
const FILES: StageDSourceFile[] = [{ path: "notes/a.md", content: "alpha" }];
const SOURCE_SHA = computeStageDManifest(FILES).manifestSha256;

const GATES_OPEN: StageDReadinessGateSnapshot = {
  phase1bUnlockIssued: false,
  liveWriteWatchIndex: 10,
  siteOwnerCoordinationConfirmed: false,
  sitesRetiredFromScan: false,
  operatorCutoverAuthorized: false,
};

let stateDir: string;
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "s33-s35-cutover-prep-"));
});
afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function mintHandle(
  overrides: Partial<Parameters<typeof createMemoryWorkspaceHandle>[0]> = {},
): MemoryWorkspaceHandle {
  const result = createMemoryWorkspaceHandle({
    resourceId: "ws:tenant-a:user:user-1:asset:asset-1",
    memoryAssetResourceId: "mem:tenant-a:asset-1",
    tenantId: "tenant-a",
    agentAssetId: "asset-1",
    bindingId: "binding-1",
    canonicalObjectKey: "canonical/tenant-a/asset-1",
    governanceVersion: 3,
    fencingToken: "fence-1",
    lifecycle: "active",
    permissions: {
      search: true,
      ingest: false,
      distill: false,
      prune: false,
      reset: false,
      export: true,
    },
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`mintHandle failed: ${result.reason}`);
  }
  return result.handle;
}

function localPlacement(): StageDDestinationPlacement {
  return {
    ok: true,
    mode: "local-only",
    canonicalHome: "local",
    projection: "none",
    region: null,
    keyRef: null,
    replicationClass: "none",
    reasonCode: "resolved",
  };
}

function policy(allowedCustodians: PlacementPolicy["allowedCustodians"]): PlacementPolicy {
  return {
    allowedCustodians,
    allowedRegions: [],
    requireDedicatedKey: false,
    requireDedicatedDatabase: false,
    offlineRequired: false,
    replicationClass: "none",
  };
}

function baseInput(overrides: Partial<SyncMemoryAssetsInput> = {}): SyncMemoryAssetsInput {
  return {
    tenantContext: { tenantId: "tenant-a" },
    actor: { tenantId: "tenant-a", userId: "user-1" },
    sourceHandle: mintHandle(),
    destinationPlacement: localPlacement(),
    syncPolicy: policy(["device"]),
    classification: "confidential",
    operationId: cutoverPrepOperationId("S33", "op1"),
    files: FILES,
    ...overrides,
  };
}

function unavailableMirrorAdapter(): StageDSyncAdapter {
  return {
    custodian: "device",
    supportsMode: (mode) => mode === "local-only",
    async copy() {
      return { ok: false, partial: false, error: "local_mirror_unavailable" };
    },
  };
}

describe("S33-S35 cutover PREP — locks, markers, matrix, retirement draft", () => {
  it("pins fail-closed locks (no cloud/BYOS/cutover/LIVE, remaining=10)", () => {
    const snapshot = evaluateS33S35CutoverPrep();
    expect(snapshot.schema).toBe(S33_S35_CUTOVER_PREP);
    expect(snapshot.productionWrite).toBe("legacy-only");
    expect(snapshot.stageDControlledWrite).toBe("shadow-only");
    expect(snapshot.cloudSyncEnabled).toBe(false);
    expect(snapshot.byosEnabled).toBe(false);
    expect(snapshot.cutoverAuthorized).toBe(false);
    expect(snapshot.implementationVerified).toBe(false);
    expect(snapshot.deployAuthorized).toBe(false);
    expect(snapshot.live).toBe("forbidden");
    expect(snapshot.remaining).toBe(10);
    expect(snapshot.liveWriteWatchIndex).toBe(10);
    expect(snapshot.item7).toBe("not-met");
    expect(snapshot.phase1bUnlock).toBe("not-issued");
    expect(snapshot.ownerCoordinationPending).toBe(true);
    expect(snapshot.siteOwner).toBe("cursor-memory-wsc");
    expect(CUTOVER_PREP_LOCKS.cutoverAuthorized).toBe(false);
  });

  it("emits an operation marker + operationId prefix per S33/S34/S35 site", () => {
    expect(S33_S35_OPERATION_MARKERS).toHaveLength(3);
    expect(S33_S35_OPERATION_MARKERS.map((m) => m.ledgerId)).toEqual(["S33", "S34", "S35"]);
    expect(S33_S35_OPERATION_MARKERS.map((m) => m.line)).toEqual([
      S33_S35_LEGACY_LINES.S33,
      S33_S35_LEGACY_LINES.S34,
      S33_S35_LEGACY_LINES.S35,
    ]);
    for (const marker of S33_S35_OPERATION_MARKERS) {
      const site = STAGE_D_SITES.find((s) => s.ledgerId === marker.ledgerId);
      expect(site).toBeDefined();
      expect(marker.file).toBe("src/memory/manager-sync-ops.ts");
      expect(marker.symbol).toBe("syncMemoryFiles");
      expect(marker.businessPhase).toBe(site?.businessPhase);
      expect(marker.canaryPhase).toBe(canaryPhaseFor(marker.ledgerId));
      expect(marker.operationAuth).toBe(site?.operationAuth);
      expect(marker.rollback).toBe(site?.rollback);
      expect(marker.productionCallSiteStillLegacy).toBe(true);
      expect(marker.operationIdPrefix).toBe(`cutover-prep-${marker.ledgerId}`);
      const opId = cutoverPrepOperationId(marker.ledgerId, "n1");
      expect(opId).toBe(`${marker.operationIdPrefix}-n1`);
    }
    expect(new Set(S33_S35_OPERATION_MARKERS.map((m) => m.businessPhase)).size).toBe(3);
    expect(new Set(S33_S35_OPERATION_MARKERS.map((m) => m.canaryPhase)).size).toBe(3);
  });

  it("refuses an unsafe operationId nonce (never a host path)", () => {
    expect(() => cutoverPrepOperationId("S33", "../etc")).toThrow(/invalid_cutover_prep_nonce/);
    expect(() => cutoverPrepOperationId("S33", "")).toThrow(/invalid_cutover_prep_nonce/);
  });

  it("records a cutover/rollback matrix that is not executed and not authorized", () => {
    expect(S33_S35_CUTOVER_ROLLBACK_MATRIX).toHaveLength(3);
    for (const row of S33_S35_CUTOVER_ROLLBACK_MATRIX) {
      expect(row.executed).toBe(false);
      expect(row.authorized).toBe(false);
      expect(row.productionWrite).toBe("legacy-only");
      expect(row.cutoverStep.length).toBeGreaterThan(0);
      expect(row.rollbackStep.length).toBeGreaterThan(0);
    }
    expect(S33_S35_CUTOVER_ROLLBACK_MATRIX.map((r) => r.rollback)).toEqual([
      "convergent-retry",
      "atomic-temp-db-swap",
      "in-place-reset",
    ]);
  });

  it("keeps the three-site retirement DRAFT unapplied (canonical scan untouched)", () => {
    const draft = S33_S35_RETIREMENT_DRAFT;
    expect(draft.kind).toBe("draft-only");
    expect(draft.applied).toBe(false);
    expect(draft.canonicalScanTouched).toBe(false);
    expect(draft.proposedRetiredLedgerIds).toEqual(["S33", "S34", "S35"]);
    expect(draft.proposedRetiredThisSlice).toBe(3);
    expect(draft.proposedRemaining).toBe(7);
    expect(draft.proposedLiveWriteWatchIndex).toBe(7);
    expect(draft.remainingUnchanged).toBe(10);
    expect(draft.liveWriteWatchIndexUnchanged).toBe(10);
    expect(draft.requiresOwnerCoordination).toBe(true);
    expect(draft.siteOwner).toBe("cursor-memory-wsc");
    expect(draft.blockedBy).toEqual(STAGE_D_PHASE_E_GATES);
    expect(draft.canonicalScanPath).toBe(
      "docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json",
    );
  });

  it("current Stage D readiness remains cutoverAuthorized=false (gates open)", () => {
    const report = evaluateStageDProductionReadiness({ gates: GATES_OPEN });
    expect(report.cutoverAuthorized).toBe(false);
    expect(report.productionWrite).toBe("legacy-only");
    expect(report.stageDControlledWrite).toBe("shadow-only");
    expect(report.cloudSyncEnabled).toBe(false);
    expect(report.byosEnabled).toBe(false);
    expect(report.remainingBlockers).toEqual(STAGE_D_PHASE_E_GATES);
    expect(report.points.every((p) => p.verdict === "shadow-not-ready")).toBe(true);
  });
});

describe("S33-S35 cutover PREP — operationId / idempotent duplicate-submit", () => {
  it("denies a missing operationId", async () => {
    const decision = await syncMemoryAssets(baseInput({ operationId: "   " }));
    expect(decision.status).toBe("denied");
    if (decision.status !== "denied") {
      return;
    }
    expect(decision.reasonCode).toBe("operation_id_conflict");
    expect(decision.sideEffects).toEqual({
      copied: false,
      uploaded: false,
      deleted: false,
      catalogWrite: false,
      hostPathFallback: false,
    });
  });

  it("replays a duplicate submit of the same identity with zero side effects", async () => {
    const store = createPersistentStageDStore({ stateDir });
    const adapter = createLocalOnlyStagingAdapter({ stateDir });
    const operationId = cutoverPrepOperationId("S33", "dup1");
    const input = baseInput({ operationId });
    const first = await syncMemoryAssets(input, {
      fencing: store,
      adapter,
      recoverySink: store.recoverySink,
    });
    expect(first.status).toBe("synced");
    const second = await syncMemoryAssets(input, {
      fencing: store,
      adapter,
      recoverySink: store.recoverySink,
    });
    expect(second.status).toBe("idempotent-replay");
    if (second.status !== "idempotent-replay") {
      return;
    }
    expect(second.operationId).toBe(operationId);
    expect(second.priorStatus).toBe("synced");
    expect(second.sideEffects).toEqual({
      copied: false,
      uploaded: false,
      deleted: false,
      catalogWrite: false,
      hostPathFallback: false,
    });
  });

  it("refuses a same operationId bound to a different resource (no cross-resource replay)", async () => {
    const store = createPersistentStageDStore({ stateDir });
    const adapter = createLocalOnlyStagingAdapter({ stateDir });
    const operationId = cutoverPrepOperationId("S34", "conflict1");
    const first = await syncMemoryAssets(baseInput({ operationId }), {
      fencing: store,
      adapter,
      recoverySink: store.recoverySink,
    });
    expect(first.status).toBe("synced");
    const other = await syncMemoryAssets(
      baseInput({
        operationId,
        sourceHandle: mintHandle({
          resourceId: "ws:tenant-a:user:user-1:asset:asset-OTHER",
          memoryAssetResourceId: "mem:tenant-a:asset-OTHER",
          agentAssetId: "asset-OTHER",
          canonicalObjectKey: "canonical/tenant-a/asset-OTHER",
        }),
      }),
      { fencing: store, adapter, recoverySink: store.recoverySink },
    );
    expect(other.status).toBe("denied");
    if (other.status !== "denied") {
      return;
    }
    expect(other.reasonCode).toBe("operation_id_conflict");
    expect(other.sideEffects.copied).toBe(false);
  });
});

describe("S33-S35 cutover PREP — recovery receipt, quarantine, tombstone, mirror, restart", () => {
  it("records recovery_required + quarantines staging on partial copy (no publish)", async () => {
    const store = createPersistentStageDStore({ stateDir });
    const adapter = createLocalOnlyStagingAdapter({ stateDir, faults: { failPublish: true } });
    const operationId = cutoverPrepOperationId("S34", "partial1");
    const decision = await syncMemoryAssets(baseInput({ operationId }), {
      fencing: store,
      adapter,
      recoverySink: store.recoverySink,
    });
    expect(decision.status).toBe("recovery-required");
    if (decision.status !== "recovery-required") {
      return;
    }
    expect(decision.halted).toBe(true);
    expect(decision.reason).toBe("partial_copy_failure");
    expect(decision.recoveryReceipt.operationId).toBe(operationId);
    expect(decision.recoveryReceipt.haltCompensation).toBe(true);
    expect(decision.recoveryReceipt.stage).toBe("memory_stage_d_sync");
    expect(adapter.isPublished(operationId)).toBe(false);
    expect(adapter.hasResidualStaging(operationId)).toBe(true);
    expect(store.getRecovery(operationId)?.reason).toBe("partial_copy_failure");
    expect(store.isRecoveryBlocked("memory-sync:ws:tenant-a:user:user-1:asset:asset-1")).toBe(true);
  });

  it("blocks a retry on a recovery_required fence until operator resolve", async () => {
    const store = createPersistentStageDStore({ stateDir });
    const adapter = createLocalOnlyStagingAdapter({
      stateDir,
      faults: { corruptStaging: true },
    });
    const firstId = cutoverPrepOperationId("S35", "rec1");
    const first = await syncMemoryAssets(baseInput({ operationId: firstId }), {
      fencing: store,
      adapter,
      recoverySink: store.recoverySink,
    });
    expect(first.status).toBe("recovery-required");
    const retry = await syncMemoryAssets(
      baseInput({ operationId: cutoverPrepOperationId("S35", "rec2") }),
      { fencing: store, adapter, recoverySink: store.recoverySink },
    );
    expect(retry.status).toBe("denied");
    if (retry.status !== "denied") {
      return;
    }
    expect(retry.reasonCode).toBe("concurrent_fencing_conflict");
  });

  it("propagates tombstone and revoke as deny (zero side effects)", async () => {
    const tombstoned = await syncMemoryAssets(baseInput({ sourceState: { tombstoned: true } }));
    expect(tombstoned.status).toBe("denied");
    if (tombstoned.status === "denied") {
      expect(tombstoned.reasonCode).toBe("source_tombstoned");
      expect(tombstoned.sideEffects.copied).toBe(false);
    }
    const revoked = await syncMemoryAssets(baseInput({ sourceState: { revoked: true } }));
    expect(revoked.status).toBe("denied");
    if (revoked.status === "denied") {
      expect(revoked.reasonCode).toBe("source_revoked");
      expect(revoked.sideEffects.copied).toBe(false);
    }
    const retired = await syncMemoryAssets(
      baseInput({ sourceHandle: mintHandle({ lifecycle: "retired" }) }),
    );
    expect(retired.status).toBe("denied");
    if (retired.status === "denied") {
      expect(retired.reasonCode).toBe("source_tombstoned");
    }
  });

  it("handles local mirror unavailable as a clean, retryable deny (no quarantine)", async () => {
    const operationId = cutoverPrepOperationId("S33", "mirror1");
    const decision = await syncMemoryAssets(baseInput({ operationId }), {
      adapter: unavailableMirrorAdapter(),
    });
    expect(decision.status).toBe("denied");
    if (decision.status !== "denied") {
      return;
    }
    expect(decision.reasonCode).toBe("destination_adapter_unconfigured");
    expect(decision.reason).toMatch(/local_mirror_unavailable/);
    expect(decision.sideEffects).toEqual({
      copied: false,
      uploaded: false,
      deleted: false,
      catalogWrite: false,
      hostPathFallback: false,
    });
  });

  it("plans (does not execute) when the fail-closed adapter has no local mirror", async () => {
    const decision = await syncMemoryAssets(
      baseInput({ operationId: cutoverPrepOperationId("S33", "plan1") }),
      { adapter: FAIL_CLOSED_SYNC_ADAPTER },
    );
    expect(decision.status).toBe("planned");
    if (decision.status !== "planned") {
      return;
    }
    expect(decision.executed).toBe(false);
    expect(decision.destinationMode).toBe("local-only");
    expect(decision.sideEffects.copied).toBe(false);
  });

  it("survives process restart: a completed operation replays from a fresh store", async () => {
    const adapter = createLocalOnlyStagingAdapter({ stateDir });
    const operationId = cutoverPrepOperationId("S33", "restart1");
    const input = baseInput({ operationId });
    const firstStore = createPersistentStageDStore({ stateDir });
    const first = await syncMemoryAssets(input, {
      fencing: firstStore,
      adapter,
      recoverySink: firstStore.recoverySink,
    });
    expect(first.status).toBe("synced");
    const restarted = createPersistentStageDStore({ stateDir });
    const replay = await syncMemoryAssets(input, {
      fencing: restarted,
      adapter,
      recoverySink: restarted.recoverySink,
    });
    expect(replay.status).toBe("idempotent-replay");
    if (replay.status !== "idempotent-replay") {
      return;
    }
    expect(replay.operationId).toBe(operationId);
    expect(replay.sideEffects.copied).toBe(false);
    expect(restarted.completedRecord(operationId)?.operationId).toBe(operationId);
  });
});

describe("S33-S35 cutover PREP — shadow canary receipt (legacy-only)", () => {
  it.each(["S33", "S34", "S35"] as const)(
    "point %s: dark canary match receipt stays shadow-only / legacy-only",
    async (point) => {
      const store = createPersistentStageDStore({ stateDir });
      const adapter = createLocalOnlyStagingAdapter({ stateDir });
      const operationId = cutoverPrepOperationId(point, "canary1");
      const receipt = await runStageDLocalOnlyCanary(
        {
          point,
          sync: baseInput({ operationId }),
          expectedSha256: SOURCE_SHA,
          env: DARK_ON,
        },
        { fencing: store, adapter, recoverySink: store.recoverySink },
      );
      expect(receipt).not.toBeNull();
      if (!receipt) {
        return;
      }
      expect(receipt.point).toBe(point);
      expect(receipt.businessPhase).toBe(canaryPhaseFor(point));
      expect(receipt.operationId).toBe(operationId);
      expect(receipt.controlledSyncStatus).toBe("synced");
      expect(receipt.identityComparison).toBe("match");
      expect(receipt.quarantine).toBe(false);
      expect(receipt.productionWrite).toBe("legacy-only");
      expect(receipt.stageDControlledWrite).toBe("shadow-only");
      expect(receipt.cloudSyncEnabled).toBe(false);
      expect(receipt.byosEnabled).toBe(false);
      const dest = writeStageDCanaryReceipt(receipt, { stateDir });
      expect(fs.existsSync(dest)).toBe(true);
      expect(dest).toContain("stage-d-sync");
      expect(dest).toContain("canary");
    },
  );
});
