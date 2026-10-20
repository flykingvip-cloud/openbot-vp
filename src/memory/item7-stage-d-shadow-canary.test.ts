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
  canaryPhaseFor,
  runStageDLocalOnlyCanary,
  STAGE_D_CANARY_POINTS,
  writeStageDCanaryReceipt,
  type StageDCanaryPoint,
} from "./item7-stage-d-shadow-canary.js";
import {
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
} from "./memory-workspace-handle.js";

const DARK_ON = { OPENBOT_ITEM7_W1_DARK_DUAL_READ: "1" } as NodeJS.ProcessEnv;
const DARK_OFF = {} as NodeJS.ProcessEnv;
const FILES: StageDSourceFile[] = [{ path: "notes/a.md", content: "alpha" }];
const SOURCE_SHA = computeStageDManifest(FILES).manifestSha256;

let stateDir: string;
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-d-canary-"));
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

function ports() {
  const store = createPersistentStageDStore({ stateDir });
  const adapter = createLocalOnlyStagingAdapter({ stateDir });
  return { store, adapter, sync: { fencing: store, adapter, recoverySink: store.recoverySink } };
}

describe("Stage D shadow/canary — dark gating", () => {
  it("is a no-op (null) when the dark dual-read flag is off", async () => {
    const { sync } = ports();
    const result = await runStageDLocalOnlyCanary(
      { point: "S33", sync: syncInput("op-off"), expectedSha256: SOURCE_SHA, env: DARK_OFF },
      sync,
    );
    expect(result).toBeNull();
  });
});

describe("Stage D shadow/canary — three distinct points, legacy-only, real local-only sync", () => {
  const points: StageDCanaryPoint[] = ["S33", "S34", "S35"];

  it("maps each point to its distinct business phase", () => {
    expect(STAGE_D_CANARY_POINTS.map((p) => p.businessPhase)).toEqual([
      "admission-import",
      "safe-rebuild",
      "unsafe-rebuild",
    ]);
    expect(canaryPhaseFor("S33")).toBe("admission-import");
    expect(canaryPhaseFor("S34")).toBe("safe-rebuild");
    expect(canaryPhaseFor("S35")).toBe("unsafe-rebuild");
  });

  it.each(points)(
    "point %s: local-only sync matches identity, production stays legacy-only",
    async (point) => {
      const { sync, store, adapter } = ports();
      const receipt = await runStageDLocalOnlyCanary(
        { point, sync: syncInput(`op-${point}`), expectedSha256: SOURCE_SHA, env: DARK_ON },
        sync,
      );
      expect(receipt).not.toBeNull();
      if (!receipt) {
        return;
      }
      expect(receipt.businessPhase).toBe(canaryPhaseFor(point));
      expect(receipt.controlledSyncStatus).toBe("synced");
      expect(receipt.identityComparison).toBe("match");
      expect(receipt.quarantine).toBe(false);
      expect(receipt.productionWrite).toBe("legacy-only");
      expect(receipt.stageDControlledWrite).toBe("shadow-only");
      expect(receipt.cloudSyncEnabled).toBe(false);
      expect(receipt.byosEnabled).toBe(false);
      // The controlled sync actually ran against the isolated local fixture.
      expect(adapter.isPublished(`op-${point}`)).toBe(true);
      expect(store.completedRecord(`op-${point}`)?.operationId).toBe(`op-${point}`);
    },
  );

  it("a shadow identity mismatch quarantines (production continues legacy-only)", async () => {
    const { sync } = ports();
    const receipt = await runStageDLocalOnlyCanary(
      {
        point: "S33",
        sync: syncInput("op-mismatch"),
        expectedSha256: "f".repeat(64),
        env: DARK_ON,
      },
      sync,
    );
    expect(receipt?.identityComparison).toBe("mismatch");
    expect(receipt?.quarantine).toBe(true);
    expect(receipt?.productionWrite).toBe("legacy-only");
  });

  it("persists an auditable canary receipt durably", async () => {
    const { sync } = ports();
    const receipt = await runStageDLocalOnlyCanary(
      { point: "S34", sync: syncInput("op-audit"), expectedSha256: SOURCE_SHA, env: DARK_ON },
      sync,
    );
    expect(receipt).not.toBeNull();
    if (!receipt) {
      return;
    }
    const dest = writeStageDCanaryReceipt(receipt, { stateDir });
    expect(fs.existsSync(dest)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(dest, "utf8"));
    expect(persisted.point).toBe("S34");
    expect(persisted.stageDControlledWrite).toBe("shadow-only");
  });
});

describe("Stage D shadow/canary — non-local + unauthorized are refused (no execution)", () => {
  it("a cross-tenant handle is denied and nothing is published", async () => {
    const { sync, adapter } = ports();
    const receipt = await runStageDLocalOnlyCanary(
      {
        point: "S33",
        sync: syncInput("op-xtenant", { actor: { tenantId: "tenant-b", userId: "user-1" } }),
        expectedSha256: SOURCE_SHA,
        env: DARK_ON,
      },
      sync,
    );
    expect(receipt?.controlledSyncStatus).toBe("denied");
    expect(receipt?.identityComparison).toBe("not-executed");
    expect(adapter.isPublished("op-xtenant")).toBe(false);
  });

  it("a non-local placement is refused unconditionally (planned/denied, never synced)", async () => {
    const { sync, adapter } = ports();
    const tenantCloud: StageDDestinationPlacement = {
      ok: true,
      mode: "tenant-cloud",
      canonicalHome: "tenant_managed_cloud",
      projection: "managed_encrypted_cloud",
      region: "us",
      keyRef: { kind: "platform_tenant", keyRefId: "k", tenantId: "tenant-a" },
      replicationClass: "regional",
      reasonCode: "resolved",
    };
    const receipt = await runStageDLocalOnlyCanary(
      {
        point: "S33",
        sync: syncInput("op-cloud", {
          destinationPlacement: tenantCloud,
          syncPolicy: policy(["tenant"]),
        }),
        expectedSha256: SOURCE_SHA,
        env: DARK_ON,
      },
      sync,
    );
    expect(receipt?.controlledSyncStatus).not.toBe("synced");
    expect(adapter.isPublished("op-cloud")).toBe(false);
  });
});
