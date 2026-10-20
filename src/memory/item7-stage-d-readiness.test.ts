import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlacementPolicy } from "../gateway/data-governance/placement-resolve.js";
import { createLocalOnlyStagingAdapter } from "./item7-stage-d-local-adapter.js";
import {
  computeStageDManifest,
  type StageDDestinationPlacement,
  type StageDSourceFile,
  type SyncMemoryAssetsInput,
} from "./item7-stage-d-memory-sync.js";
import { createPersistentStageDStore } from "./item7-stage-d-persistent-store.js";
import {
  deriveShadowSignal,
  evaluateStageDProductionReadiness,
  pendingPhaseEGates,
  STAGE_D_PHASE_E_GATES,
  type StageDReadinessGateSnapshot,
  writeStageDReadinessReport,
} from "./item7-stage-d-readiness.js";
import {
  runStageDLocalOnlyCanary,
  type StageDCanaryPoint,
  type StageDCanaryReceipt,
} from "./item7-stage-d-shadow-canary.js";
import {
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
} from "./memory-workspace-handle.js";

const DARK_ON = { OPENBOT_ITEM7_W1_DARK_DUAL_READ: "1" } as NodeJS.ProcessEnv;
const FILES: StageDSourceFile[] = [{ path: "notes/a.md", content: "alpha" }];
const SOURCE_SHA = computeStageDManifest(FILES).manifestSha256;

// The current-phase reality: every Phase E gate is open, so no cutover is possible.
const GATES_OPEN: StageDReadinessGateSnapshot = {
  phase1bUnlockIssued: false,
  liveWriteWatchIndex: 10,
  siteOwnerCoordinationConfirmed: false,
  sitesRetiredFromScan: false,
  operatorCutoverAuthorized: false,
};

// Hypothetical: every gate satisfied (used only to prove the verdict logic is
// honest in BOTH directions; not the real current state).
const GATES_ALL_SATISFIED: StageDReadinessGateSnapshot = {
  phase1bUnlockIssued: true,
  liveWriteWatchIndex: 0,
  siteOwnerCoordinationConfirmed: true,
  sitesRetiredFromScan: true,
  operatorCutoverAuthorized: true,
};

let stateDir: string;
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-d-readiness-"));
});
afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function mintHandle(): MemoryWorkspaceHandle {
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

function syncInput(
  operationId: string,
  overrides: Partial<SyncMemoryAssetsInput> = {},
): SyncMemoryAssetsInput {
  return {
    tenantContext: { tenantId: "tenant-a" },
    actor: { tenantId: "tenant-a", userId: "user-1" },
    sourceHandle: mintHandle(),
    destinationPlacement: localPlacement(),
    syncPolicy: policy(["device"]),
    classification: "confidential",
    operationId,
    files: FILES,
    ...overrides,
  };
}

async function runCanaryReceipt(
  point: StageDCanaryPoint,
  operationId: string,
  expectedSha256: string,
  overrides: Partial<SyncMemoryAssetsInput> = {},
): Promise<StageDCanaryReceipt> {
  const store = createPersistentStageDStore({ stateDir });
  const adapter = createLocalOnlyStagingAdapter({ stateDir });
  const receipt = await runStageDLocalOnlyCanary(
    { point, sync: syncInput(operationId, overrides), expectedSha256, env: DARK_ON },
    { fencing: store, adapter, recoverySink: store.recoverySink },
  );
  if (!receipt) {
    throw new Error("canary returned null (dark flag off?)");
  }
  return receipt;
}

async function matchReceiptsForAllPoints(): Promise<StageDCanaryReceipt[]> {
  return [
    await runCanaryReceipt("S33", "op-S33", SOURCE_SHA),
    await runCanaryReceipt("S34", "op-S34", SOURCE_SHA),
    await runCanaryReceipt("S35", "op-S35", SOURCE_SHA),
  ];
}

describe("Stage D readiness — pendingPhaseEGates (pure)", () => {
  it("reports all five gates pending in the current-phase reality", () => {
    expect(pendingPhaseEGates(GATES_OPEN)).toEqual([...STAGE_D_PHASE_E_GATES]);
  });

  it("reports no pending gates when every gate is satisfied", () => {
    expect(pendingPhaseEGates(GATES_ALL_SATISFIED)).toEqual([]);
  });

  it("reports only the still-open gates for a partial snapshot", () => {
    expect(
      pendingPhaseEGates({
        ...GATES_OPEN,
        liveWriteWatchIndex: 0,
        phase1bUnlockIssued: true,
      }),
    ).toEqual([
      "site_owner_coordination",
      "site_retired_from_scan",
      "operator_cutover_authorization",
    ]);
  });
});

describe("Stage D readiness — deriveShadowSignal (pure)", () => {
  it("treats an absent receipt as not-exercised (never ready)", () => {
    expect(deriveShadowSignal(undefined)).toBe("not-exercised");
  });

  it("passes through the canary identity comparison", () => {
    const base = {
      schema: "item7-stage-d-shadow-canary/v1",
      point: "S33",
      businessPhase: "admission-import",
      operationId: "op",
      controlledSyncStatus: "synced",
      syncedSha256: "a",
      expectedSha256: "a",
      quarantine: false,
      productionWrite: "legacy-only",
      stageDControlledWrite: "shadow-only",
      cloudSyncEnabled: false,
      byosEnabled: false,
      createdAt: "t",
    } as const;
    expect(deriveShadowSignal({ ...base, identityComparison: "match" })).toBe("match");
    expect(deriveShadowSignal({ ...base, identityComparison: "mismatch" })).toBe("mismatch");
    expect(deriveShadowSignal({ ...base, identityComparison: "not-executed" })).toBe(
      "not-executed",
    );
  });
});

describe("Stage D readiness — current-phase reality (no canary receipts)", () => {
  it("holds every S33/S34/S35 point shadow-not-ready and never authorizes cutover", () => {
    const report = evaluateStageDProductionReadiness({ gates: GATES_OPEN });

    expect(report.points.map((point) => point.point)).toEqual(["S33", "S34", "S35"]);
    for (const point of report.points) {
      expect(point.shadowSignal).toBe("not-exercised");
      expect(point.shadowReady).toBe(false);
      expect(point.verdict).toBe("shadow-not-ready");
      expect(point.pendingGates).toEqual([...STAGE_D_PHASE_E_GATES]);
      expect(point.file).toBe("src/memory/manager-sync-ops.ts");
      expect(point.symbol).toBe("syncMemoryFiles");
    }

    // Canonical per-site metadata is sourced from STAGE_D_SITES (not fabricated).
    const s33 = report.points.find((point) => point.point === "S33");
    expect(s33?.businessPhase).toBe("admission-import");
    expect(s33?.operationAuth).toBe("sync");
    expect(s33?.rollback).toBe("convergent-retry");
    const s35 = report.points.find((point) => point.point === "S35");
    expect(s35?.rollback).toBe("in-place-reset");

    expect(report.cutoverAuthorized).toBe(false);
    expect(report.remainingBlockers).toEqual([...STAGE_D_PHASE_E_GATES]);
    expect(report.productionWrite).toBe("legacy-only");
    expect(report.stageDControlledWrite).toBe("shadow-only");
    expect(report.cloudSyncEnabled).toBe(false);
    expect(report.byosEnabled).toBe(false);
  });
});

describe("Stage D readiness — dark canary match, governance gates still open", () => {
  it("marks each point shadow-ready-pending-cutover but keeps cutover unauthorized", async () => {
    const report = evaluateStageDProductionReadiness({
      gates: GATES_OPEN,
      canaryReceipts: await matchReceiptsForAllPoints(),
    });

    for (const point of report.points) {
      expect(point.shadowSignal).toBe("match");
      expect(point.shadowReady).toBe(true);
      expect(point.verdict).toBe("shadow-ready-pending-cutover");
      expect(point.pendingGates).toEqual([...STAGE_D_PHASE_E_GATES]);
    }
    expect(report.cutoverAuthorized).toBe(false);
    expect(report.remainingBlockers).toEqual([...STAGE_D_PHASE_E_GATES]);
    // Shadow readiness NEVER implies the production posture changed.
    expect(report.productionWrite).toBe("legacy-only");
    expect(report.stageDControlledWrite).toBe("shadow-only");
  });
});

describe("Stage D readiness — fail-closed shadow signals", () => {
  it("a shadow identity mismatch is shadow-not-ready", async () => {
    const mismatch = await runCanaryReceipt("S33", "op-mismatch", "f".repeat(64));
    const report = evaluateStageDProductionReadiness({
      gates: GATES_OPEN,
      canaryReceipts: [mismatch],
    });
    const s33 = report.points.find((point) => point.point === "S33");
    expect(s33?.shadowSignal).toBe("mismatch");
    expect(s33?.shadowReady).toBe(false);
    expect(s33?.verdict).toBe("shadow-not-ready");
  });

  it("a cross-tenant denied canary is not-executed => shadow-not-ready", async () => {
    const denied = await runCanaryReceipt("S34", "op-xtenant", SOURCE_SHA, {
      actor: { tenantId: "tenant-b", userId: "user-1" },
    });
    expect(denied.controlledSyncStatus).toBe("denied");
    const report = evaluateStageDProductionReadiness({
      gates: GATES_OPEN,
      canaryReceipts: [denied],
    });
    const s34 = report.points.find((point) => point.point === "S34");
    expect(s34?.shadowSignal).toBe("not-executed");
    expect(s34?.verdict).toBe("shadow-not-ready");
  });

  it("a point without a receipt stays not-exercised while others match (partial coverage)", async () => {
    const report = evaluateStageDProductionReadiness({
      gates: GATES_OPEN,
      canaryReceipts: [await runCanaryReceipt("S33", "op-S33-only", SOURCE_SHA)],
    });
    expect(report.points.find((point) => point.point === "S33")?.shadowSignal).toBe("match");
    expect(report.points.find((point) => point.point === "S34")?.shadowSignal).toBe(
      "not-exercised",
    );
    expect(report.points.find((point) => point.point === "S35")?.shadowSignal).toBe(
      "not-exercised",
    );
    expect(report.cutoverAuthorized).toBe(false);
  });
});

describe("Stage D readiness — honest cutover-eligible only when everything holds", () => {
  it("reports cutover-eligible + cutoverAuthorized only with all shadows match AND all gates satisfied", async () => {
    const report = evaluateStageDProductionReadiness({
      gates: GATES_ALL_SATISFIED,
      canaryReceipts: await matchReceiptsForAllPoints(),
    });
    for (const point of report.points) {
      expect(point.verdict).toBe("cutover-eligible");
      expect(point.pendingGates).toEqual([]);
    }
    expect(report.remainingBlockers).toEqual([]);
    expect(report.cutoverAuthorized).toBe(true);
    // Even when eligible, the assessment itself performs no switch: the posture
    // fields remain legacy-only / shadow-only (this module never cuts over).
    expect(report.productionWrite).toBe("legacy-only");
    expect(report.stageDControlledWrite).toBe("shadow-only");
  });

  it("stays unauthorized if shadows match but a single gate remains open", async () => {
    const report = evaluateStageDProductionReadiness({
      gates: { ...GATES_ALL_SATISFIED, operatorCutoverAuthorized: false },
      canaryReceipts: await matchReceiptsForAllPoints(),
    });
    expect(report.cutoverAuthorized).toBe(false);
    expect(report.remainingBlockers).toEqual(["operator_cutover_authorization"]);
    for (const point of report.points) {
      expect(point.verdict).toBe("shadow-ready-pending-cutover");
    }
  });
});

describe("Stage D readiness — durable report", () => {
  it("persists an auditable readiness report under the governed root", () => {
    const report = evaluateStageDProductionReadiness({ gates: GATES_OPEN });
    const dest = writeStageDReadinessReport(report, { stateDir });
    expect(fs.existsSync(dest)).toBe(true);
    expect(
      dest.startsWith(path.join(stateDir, "data-governance", "stage-d-sync", "readiness")),
    ).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(dest, "utf8"));
    expect(persisted.schema).toBe("item7-stage-d-readiness/v1");
    expect(persisted.cutoverAuthorized).toBe(false);
    expect(persisted.productionWrite).toBe("legacy-only");
  });
});
