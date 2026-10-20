import { describe, expect, it } from "vitest";
import type { PlacementPolicy } from "../gateway/data-governance/placement-resolve.js";
import {
  computeStageDManifest,
  createInMemoryFencingStore,
  FAIL_CLOSED_SYNC_ADAPTER,
  findStageDSite,
  planMemoryAssetSync,
  runItem7StageDMemorySyncShadow,
  sameStageDCompletion,
  scheduleItem7StageDMemorySyncShadow,
  STAGE_D_SITES,
  syncMemoryAssets,
  type StageDCompletionRecord,
  type StageDDestinationPlacement,
  type StageDFencingStore,
  type StageDSourceFile,
  type StageDSyncAdapter,
  type SyncMemoryAssetsInput,
} from "./item7-stage-d-memory-sync.js";
import {
  createMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
  type MemoryWorkspaceResolveResult,
} from "./memory-workspace-handle.js";

const DARK_ON = { OPENBOT_ITEM7_W1_DARK_DUAL_READ: "1" } as NodeJS.ProcessEnv;
const DARK_OFF = {} as NodeJS.ProcessEnv;

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
    throw new Error(`mintHandle fixture failed: ${result.reason}`);
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

function tenantCloudPlacement(): StageDDestinationPlacement {
  return {
    ok: true,
    mode: "tenant-cloud",
    canonicalHome: "tenant_managed_cloud",
    projection: "managed_encrypted_cloud",
    region: "us-east",
    keyRef: { kind: "platform_tenant", keyRefId: "key-1", tenantId: "tenant-a" },
    replicationClass: "regional",
    reasonCode: "resolved",
  };
}

function byosPlacement(): StageDDestinationPlacement {
  return {
    ok: true,
    mode: "byos",
    canonicalHome: "byos",
    projection: "none",
    region: "us-east",
    keyRef: { kind: "byos_customer", keyRefId: "key-2", tenantId: "tenant-a" },
    replicationClass: "regional",
    reasonCode: "resolved",
  };
}

function policy(allowedCustodians: PlacementPolicy["allowedCustodians"]): PlacementPolicy {
  return {
    allowedCustodians,
    allowedRegions: ["us-east"],
    requireDedicatedKey: false,
    requireDedicatedDatabase: false,
    offlineRequired: false,
    replicationClass: "none",
  };
}

function localAdapter(opts: { partial?: boolean; corrupt?: boolean } = {}): StageDSyncAdapter {
  return {
    custodian: "device",
    supportsMode: (mode) => mode === "local-only",
    async copy({ manifest }) {
      if (opts.partial) {
        return { ok: false, partial: true, error: "disk_full_mid_copy" };
      }
      if (opts.corrupt) {
        return { ok: true, writtenSha256: "0".repeat(64) };
      }
      return { ok: true, writtenSha256: manifest.manifestSha256 };
    },
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
    operationId: "op-1",
    files: [{ path: "notes/a.md", content: "alpha" }],
    ...overrides,
  };
}

describe("Item 7 Stage D — controlled sync authorize/deny semantics", () => {
  it("denies when tenant context is missing (zero side effects)", async () => {
    const decision = await syncMemoryAssets(baseInput({ tenantContext: null }));
    expect(decision.status).toBe("denied");
    if (decision.status !== "denied") {
      return;
    }
    expect(decision.reasonCode).toBe("missing_tenant_context");
    expect(decision.sideEffects).toEqual({
      copied: false,
      uploaded: false,
      deleted: false,
      catalogWrite: false,
      hostPathFallback: false,
    });
  });

  it("denies when actor is missing", async () => {
    const decision = await syncMemoryAssets(baseInput({ actor: null }));
    expect(decision.status === "denied" && decision.reasonCode).toBe("missing_actor");
  });

  it("denies when the handle lacks the export grant", async () => {
    const handle = mintHandle({
      permissions: {
        search: true,
        ingest: false,
        distill: false,
        prune: false,
        reset: false,
        export: false,
      },
    });
    const decision = await syncMemoryAssets(baseInput({ sourceHandle: handle }));
    expect(decision.status === "denied" && decision.reasonCode).toBe("missing_grant");
  });

  it("refuses a raw path / non-branded source (no arbitrary path parameter)", async () => {
    const decision = await syncMemoryAssets(
      baseInput({ sourceHandle: { resourceId: "/etc/passwd" } as unknown }),
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("source_not_canonical_handle");
  });

  it("denies cross-tenant actor and cross-tenant handle", async () => {
    const actorMismatch = await syncMemoryAssets(
      baseInput({ actor: { tenantId: "tenant-b", userId: "user-1" } }),
    );
    expect(actorMismatch.status === "denied" && actorMismatch.reasonCode).toBe("cross_tenant");

    const handleMismatch = await syncMemoryAssets(
      baseInput({
        tenantContext: { tenantId: "tenant-b" },
        actor: { tenantId: "tenant-b", userId: "user-1" },
      }),
    );
    expect(handleMismatch.status === "denied" && handleMismatch.reasonCode).toBe("cross_tenant");
  });

  it("denies when classification forbids the destination mode (restricted stays local)", async () => {
    // classification is enforced in the plan, before the non-local fail-closed gate.
    const decision = await syncMemoryAssets(
      baseInput({
        classification: "restricted",
        destinationPlacement: tenantCloudPlacement(),
        syncPolicy: policy(["tenant"]),
      }),
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("classification_forbids_sync");
  });

  it("denies when sync policy does not allow the required custodian", async () => {
    const decision = await syncMemoryAssets(baseInput({ syncPolicy: policy(["openbot"]) }));
    expect(decision.status === "denied" && decision.reasonCode).toBe(
      "sync_policy_custodian_not_allowed",
    );
  });
});

describe("Item 7 Stage D — fail-closed cloud/BYOS", () => {
  it("fails closed on cloud (tenant-cloud) when not approved", async () => {
    const decision = await syncMemoryAssets(
      baseInput({ destinationPlacement: tenantCloudPlacement(), syncPolicy: policy(["tenant"]) }),
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("cloud_sync_not_approved");
    expect(decision.status === "denied" && decision.sideEffects.uploaded).toBe(false);
  });

  it("fails closed on BYOS when not approved", async () => {
    const decision = await syncMemoryAssets(
      baseInput({ destinationPlacement: byosPlacement(), syncPolicy: policy(["byos"]) }),
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("byos_not_approved");
  });

  it("refuses cloud even when a supporting cloud adapter is injected, and never calls copy", async () => {
    // CR1 P1-1: there is no approval escape hatch, so a non-local copy must never execute.
    let copyCalled = false;
    const cloudAdapter: StageDSyncAdapter = {
      custodian: "tenant",
      supportsMode: (m) => m === "tenant-cloud",
      async copy({ manifest }) {
        copyCalled = true;
        return { ok: true, writtenSha256: manifest.manifestSha256 };
      },
    };
    const decision = await syncMemoryAssets(
      baseInput({ destinationPlacement: tenantCloudPlacement(), syncPolicy: policy(["tenant"]) }),
      { adapter: cloudAdapter },
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("cloud_sync_not_approved");
    expect(copyCalled).toBe(false);
    expect(decision.status === "denied" && decision.sideEffects.copied).toBe(false);
    expect(decision.status === "denied" && decision.sideEffects.uploaded).toBe(false);
  });

  it("refuses BYOS even with a supporting BYOS adapter, and never calls copy", async () => {
    let copyCalled = false;
    const byosAdapter: StageDSyncAdapter = {
      custodian: "byos",
      supportsMode: (m) => m === "byos",
      async copy({ manifest }) {
        copyCalled = true;
        return { ok: true, writtenSha256: manifest.manifestSha256 };
      },
    };
    const decision = await syncMemoryAssets(
      baseInput({ destinationPlacement: byosPlacement(), syncPolicy: policy(["byos"]) }),
      { adapter: byosAdapter },
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("byos_not_approved");
    expect(copyCalled).toBe(false);
  });
});

describe("Item 7 Stage D — adapter, idempotency, fencing", () => {
  it("plans (does not execute) with the fail-closed default adapter and writes a receipt", async () => {
    const decision = await syncMemoryAssets(baseInput(), { adapter: FAIL_CLOSED_SYNC_ADAPTER });
    expect(decision.status).toBe("planned");
    if (decision.status !== "planned") {
      return;
    }
    expect(decision.executed).toBe(false);
    expect(decision.sideEffects.copied).toBe(false);
    expect(decision.receipt.tenantId).toBe("tenant-a");
    expect(decision.receipt.sourceResourceId).toBe("ws:tenant-a:user:user-1:asset:asset-1");
    expect(decision.receipt.classification).toBe("confidential");
    expect(decision.receipt.status).toBe("planned");
  });

  it("is idempotent for a duplicate operationId (no re-copy)", async () => {
    const fencing = createInMemoryFencingStore();
    const first = await syncMemoryAssets(baseInput({ operationId: "op-dup" }), {
      adapter: localAdapter(),
      fencing,
    });
    expect(first.status).toBe("synced");
    const replay = await syncMemoryAssets(baseInput({ operationId: "op-dup" }), {
      adapter: localAdapter(),
      fencing,
    });
    expect(replay.status).toBe("idempotent-replay");
    expect(replay.status === "idempotent-replay" && replay.sideEffects.copied).toBe(false);
  });

  it("denies a concurrent same-resource sync (exclusive fencing)", async () => {
    const busy: StageDFencingStore = {
      tryAcquire: () => ({ acquired: false, reason: "concurrent" }),
      completedRecord: () => null,
      markCompleted: () => undefined,
      release: () => undefined,
    };
    const decision = await syncMemoryAssets(baseInput(), {
      adapter: localAdapter(),
      fencing: busy,
    });
    expect(decision.status === "denied" && decision.reasonCode).toBe("concurrent_fencing_conflict");
  });

  it("denies on a stale fencing token", async () => {
    const stale: StageDFencingStore = {
      tryAcquire: () => ({ acquired: false, reason: "stale_token" }),
      completedRecord: () => null,
      markCompleted: () => undefined,
      release: () => undefined,
    };
    const decision = await syncMemoryAssets(baseInput(), {
      adapter: localAdapter(),
      fencing: stale,
    });
    expect(decision.status === "denied" && decision.reasonCode).toBe("stale_fencing_token");
  });
});

describe("Item 7 Stage D — copy integrity + recovery", () => {
  it("legitimate local controlled sync succeeds with a verified hash", async () => {
    const decision = await syncMemoryAssets(baseInput({ operationId: "op-local" }), {
      adapter: localAdapter(),
    });
    expect(decision.status).toBe("synced");
    if (decision.status !== "synced") {
      return;
    }
    expect(decision.destinationMode).toBe("local-only");
    expect(decision.verifiedSha256).toBe(decision.manifest.manifestSha256);
    expect(decision.receipt.status).toBe("synced");
    expect(decision.sideEffects.copied).toBe(true);
    expect(decision.sideEffects.deleted).toBe(false);
    expect(decision.sideEffects.uploaded).toBe(false);
  });

  it("hash mismatch after copy => recovery_required + halt (never 'synced')", async () => {
    const decision = await syncMemoryAssets(baseInput({ operationId: "op-corrupt" }), {
      adapter: localAdapter({ corrupt: true }),
    });
    expect(decision.status).toBe("recovery-required");
    if (decision.status !== "recovery-required") {
      return;
    }
    expect(decision.reason).toBe("hash_mismatch");
    expect(decision.halted).toBe(true);
    expect(decision.recoveryReceipt.haltCompensation).toBe(true);
  });

  it("partial copy failure => recovery_required + halt", async () => {
    const decision = await syncMemoryAssets(baseInput({ operationId: "op-partial" }), {
      adapter: localAdapter({ partial: true }),
    });
    expect(decision.status).toBe("recovery-required");
    expect(decision.status === "recovery-required" && decision.reason).toBe("partial_copy_failure");
  });
});

describe("Item 7 Stage D — tombstone / revoke / legal hold", () => {
  it("refuses to sync a tombstoned source", async () => {
    const decision = await syncMemoryAssets(baseInput({ sourceState: { tombstoned: true } }));
    expect(decision.status === "denied" && decision.reasonCode).toBe("source_tombstoned");
  });

  it("refuses to sync a revoked source", async () => {
    const decision = await syncMemoryAssets(baseInput({ sourceState: { revoked: true } }));
    expect(decision.status === "denied" && decision.reasonCode).toBe("source_revoked");
  });

  it("refuses a retired/purged handle lifecycle", async () => {
    const decision = await syncMemoryAssets(
      baseInput({ sourceHandle: mintHandle({ lifecycle: "retired" }) }),
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("source_tombstoned");
  });

  it("legal hold forbids a physical delete during sync", async () => {
    const decision = await syncMemoryAssets(
      baseInput({ legalHoldActive: true, intendsPhysicalDelete: true }),
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe(
      "legal_hold_forbids_physical_delete",
    );
  });

  it("never deletes even on a successful sync", async () => {
    const decision = await syncMemoryAssets(baseInput({ operationId: "op-nodelete" }), {
      adapter: localAdapter(),
    });
    expect(decision.status === "synced" && decision.sideEffects.deleted).toBe(false);
  });
});

describe("Item 7 Stage D — reject paths perform zero copy/upload/delete", () => {
  const rejectInputs: Array<[string, SyncMemoryAssetsInput]> = [
    ["missing tenant", baseInput({ tenantContext: null })],
    ["missing actor", baseInput({ actor: null })],
    ["raw path source", baseInput({ sourceHandle: { p: "/x" } as unknown })],
    ["cross tenant", baseInput({ actor: { tenantId: "tenant-z", userId: "user-1" } })],
    ["policy reject", baseInput({ syncPolicy: policy(["openbot"]) })],
    [
      "cloud not approved",
      baseInput({ destinationPlacement: tenantCloudPlacement(), syncPolicy: policy(["tenant"]) }),
    ],
    [
      "byos not approved",
      baseInput({ destinationPlacement: byosPlacement(), syncPolicy: policy(["byos"]) }),
    ],
    ["tombstoned", baseInput({ sourceState: { tombstoned: true } })],
  ];

  it.each(rejectInputs)("%s => denied with all side-effect flags false", async (_label, input) => {
    const decision = await syncMemoryAssets(input);
    expect(decision.status).toBe("denied");
    if (decision.status !== "denied") {
      return;
    }
    expect(decision.sideEffects.copied).toBe(false);
    expect(decision.sideEffects.uploaded).toBe(false);
    expect(decision.sideEffects.deleted).toBe(false);
    expect(decision.sideEffects.catalogWrite).toBe(false);
    expect(decision.sideEffects.hostPathFallback).toBe(false);
  });
});

describe("Item 7 Stage D — manifest hashing", () => {
  it("hashes deterministically and independent of input order", () => {
    const files: StageDSourceFile[] = [
      { path: "b.md", content: "two" },
      { path: "a.md", content: "one" },
    ];
    const reordered: StageDSourceFile[] = [
      { path: "a.md", content: "one" },
      { path: "b.md", content: "two" },
    ];
    const m1 = computeStageDManifest(files);
    const m2 = computeStageDManifest(reordered);
    expect(m1.manifestSha256).toBe(m2.manifestSha256);
    expect(m1.entries).toHaveLength(2);
    expect(m1.entries[0].path).toBe("a.md");
  });
});

describe("Item 7 Stage D — planMemoryAssetSync (pure authorize/validate)", () => {
  it("returns a ready plan for a fully authorized local sync", () => {
    const result = planMemoryAssetSync(baseInput());
    expect("ok" in result).toBe(true);
    if ("ok" in result && result.ok) {
      expect(result.plan.destinationMode).toBe("local-only");
      expect(result.plan.requiredCustodian).toBe("device");
      expect(result.plan.classification).toBe("confidential");
      expect(result.plan.fenceKey).toContain(result.plan.handle.resourceId);
    }
  });

  it("returns a denied decision (never a plan) for missing tenant context", () => {
    const result = planMemoryAssetSync(baseInput({ tenantContext: null }));
    expect("status" in result && result.status).toBe("denied");
  });
});

describe("Item 7 Stage D — the three sites are distinct (D1/D2/D3)", () => {
  it("registers S33/S34/S35 with distinct business phases", () => {
    expect(STAGE_D_SITES).toHaveLength(3);
    expect(STAGE_D_SITES.map((s) => s.ledgerId)).toEqual(["S33", "S34", "S35"]);
    expect(STAGE_D_SITES.map((s) => s.point)).toEqual(["D1", "D2", "D3"]);
    const phases = new Set(STAGE_D_SITES.map((s) => s.businessPhase));
    expect(phases.size).toBe(3);
    expect(findStageDSite("S33")?.businessPhase).toBe("admission-import");
    expect(findStageDSite("S34")?.businessPhase).toBe("rebuild-reindex-safe");
    expect(findStageDSite("S35")?.businessPhase).toBe("rebuild-reindex-unsafe");
    expect(findStageDSite("S34")?.rollback).toBe("atomic-temp-db-swap");
    expect(findStageDSite("S35")?.rollback).toBe("in-place-reset");
  });

  it("all sites keep symbol=syncMemoryFiles and op=index/sync in one file", () => {
    for (const site of STAGE_D_SITES) {
      expect(site.symbol).toBe("syncMemoryFiles");
      expect(site.op).toBe("index/sync");
      expect(site.file).toBe("src/memory/manager-sync-ops.ts");
    }
  });
});

describe("Item 7 Stage D — dark shadow (env-gated, fail-closed, legacy-only)", () => {
  const denyResolve = async (): Promise<MemoryWorkspaceResolveResult> => ({
    ok: false,
    reasonCode: "missing_workspace_resource",
    reason: "catalog miss",
  });
  const hitResolve = async (): Promise<MemoryWorkspaceResolveResult> => ({
    ok: true,
    handle: mintHandle(),
  });

  it("is a no-op (null) for every site when the dark flag is off", async () => {
    for (const site of STAGE_D_SITES) {
      const proof = await runItem7StageDMemorySyncShadow({
        ledgerId: site.ledgerId,
        businessPhase: site.businessPhase,
        resolveHandle: hitResolve,
        env: DARK_OFF,
      });
      expect(proof).toBeNull();
    }
  });

  it("on catalog miss: handleResourceId null, index quarantined, controlled-sync denied, legacy-only", async () => {
    const proof = await runItem7StageDMemorySyncShadow({
      ledgerId: "S33",
      businessPhase: "admission-import",
      resolveHandle: denyResolve,
      env: DARK_ON,
    });
    expect(proof).not.toBeNull();
    if (!proof) {
      return;
    }
    expect(proof.handleResourceId).toBeNull();
    expect(proof.indexIdentity?.handleIdentity).toBe("miss");
    expect(proof.indexIdentity?.quarantine).toBe(true);
    expect(proof.indexIdentity?.indexSwitch.allow).toBe(false);
    expect(proof.productionWrite).toBe("legacy-only");
    expect(proof.controlledSync.status).toBe("denied");
  });

  it("on catalog hit: proves real handle identity but stays fail-closed and legacy-only", async () => {
    const proof = await runItem7StageDMemorySyncShadow({
      ledgerId: "S34",
      businessPhase: "rebuild-reindex-safe",
      resolveHandle: hitResolve,
      env: DARK_ON,
    });
    expect(proof).not.toBeNull();
    if (!proof) {
      return;
    }
    expect(proof.handleResourceId).toBe("ws:tenant-a:user:user-1:asset:asset-1");
    expect(proof.indexIdentity?.handleIdentity).toBe("hit");
    expect(proof.indexIdentity?.quarantine).toBe(false);
    expect(proof.productionWrite).toBe("legacy-only");
    // No actor/placement in the shadow => controlled sync still refuses (fail-closed).
    expect(proof.controlledSync.status).toBe("denied");
  });

  it("never throws when the read-only resolve throws", async () => {
    const proof = await runItem7StageDMemorySyncShadow({
      ledgerId: "S35",
      businessPhase: "rebuild-reindex-unsafe",
      resolveHandle: async () => {
        throw new Error("catalog exploded");
      },
      env: DARK_ON,
    });
    expect(proof?.handleResourceId).toBeNull();
    expect(proof?.controlledSync.status).toBe("denied");
  });

  it("schedule entry is fire-and-forget and does not throw", () => {
    expect(() =>
      scheduleItem7StageDMemorySyncShadow({
        ledgerId: "S33",
        businessPhase: "admission-import",
        env: DARK_OFF,
      }),
    ).not.toThrow();
  });
});

describe("Item 7 Stage D — aggregate (all three points)", () => {
  it("every point proves identity in shadow and keeps production legacy-only with zero side effects", async () => {
    const hitResolve = async (): Promise<MemoryWorkspaceResolveResult> => ({
      ok: true,
      handle: mintHandle(),
    });
    for (const site of STAGE_D_SITES) {
      const proof = await runItem7StageDMemorySyncShadow({
        ledgerId: site.ledgerId,
        businessPhase: site.businessPhase,
        resolveHandle: hitResolve,
        env: DARK_ON,
      });
      expect(proof?.indexIdentity?.handleIdentity).toBe("hit");
      expect(proof?.productionWrite).toBe("legacy-only");
      expect(proof?.controlledSync.status).toBe("denied");
      if (proof?.controlledSync.status === "denied") {
        expect(proof.controlledSync.sideEffects.copied).toBe(false);
        expect(proof.controlledSync.sideEffects.uploaded).toBe(false);
        expect(proof.controlledSync.sideEffects.deleted).toBe(false);
      }
    }
  });
});

describe("Item 7 Stage D — CR1: resource-bound operationId idempotency", () => {
  async function seededLocalSync(fencing: StageDFencingStore): Promise<void> {
    const first = await syncMemoryAssets(baseInput({ operationId: "op-shared" }), {
      adapter: localAdapter(),
      fencing,
    });
    expect(first.status).toBe("synced");
  }

  it("replays only when every identity field matches", async () => {
    const fencing = createInMemoryFencingStore();
    await seededLocalSync(fencing);
    const replay = await syncMemoryAssets(baseInput({ operationId: "op-shared" }), {
      adapter: localAdapter(),
      fencing,
    });
    expect(replay.status).toBe("idempotent-replay");
    expect(replay.status === "idempotent-replay" && replay.sideEffects.copied).toBe(false);
  });

  it("rejects the same operationId reused across a different tenant (no cross-tenant replay)", async () => {
    const fencing = createInMemoryFencingStore();
    await seededLocalSync(fencing);
    const decision = await syncMemoryAssets(
      baseInput({
        operationId: "op-shared",
        tenantContext: { tenantId: "tenant-b" },
        actor: { tenantId: "tenant-b", userId: "user-1" },
        sourceHandle: mintHandle({
          tenantId: "tenant-b",
          resourceId: "ws:tenant-b:user:user-1:asset:asset-1",
          memoryAssetResourceId: "mem:tenant-b:asset-1",
        }),
      }),
      { adapter: localAdapter(), fencing },
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("operation_id_conflict");
    expect(decision.status === "denied" && decision.sideEffects.copied).toBe(false);
  });

  it("rejects the same operationId reused across a different resource (no cross-resource replay)", async () => {
    const fencing = createInMemoryFencingStore();
    await seededLocalSync(fencing);
    const decision = await syncMemoryAssets(
      baseInput({
        operationId: "op-shared",
        sourceHandle: mintHandle({
          resourceId: "ws:tenant-a:user:user-1:asset:asset-2",
          memoryAssetResourceId: "mem:tenant-a:asset-2",
        }),
      }),
      { adapter: localAdapter(), fencing },
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("operation_id_conflict");
  });

  it("rejects the same operationId when the manifest differs", async () => {
    const fencing = createInMemoryFencingStore();
    await seededLocalSync(fencing);
    const decision = await syncMemoryAssets(
      baseInput({
        operationId: "op-shared",
        files: [{ path: "notes/a.md", content: "DIFFERENT" }],
      }),
      { adapter: localAdapter(), fencing },
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("operation_id_conflict");
  });

  it("rejects the same operationId when the classification differs", async () => {
    const fencing = createInMemoryFencingStore();
    await seededLocalSync(fencing);
    const decision = await syncMemoryAssets(
      baseInput({ operationId: "op-shared", classification: "internal" }),
      { adapter: localAdapter(), fencing },
    );
    expect(decision.status === "denied" && decision.reasonCode).toBe("operation_id_conflict");
  });
});

describe("Item 7 Stage D — CR1: sameStageDCompletion comparator", () => {
  const base: StageDCompletionRecord = {
    operationId: "op",
    tenantId: "tenant-a",
    sourceResourceId: "ws:tenant-a:user:user-1:asset:asset-1",
    destinationMode: "local-only",
    manifestSha256: "abc",
    classification: "confidential",
  };

  it("returns true only when all six fields match", () => {
    expect(sameStageDCompletion(base, { ...base })).toBe(true);
  });

  it("returns false when any single field diverges (tenant/resource/mode/manifest/class/op)", () => {
    expect(sameStageDCompletion(base, { ...base, tenantId: "tenant-b" })).toBe(false);
    expect(sameStageDCompletion(base, { ...base, sourceResourceId: "ws:other" })).toBe(false);
    expect(sameStageDCompletion(base, { ...base, destinationMode: "tenant-cloud" })).toBe(false);
    expect(sameStageDCompletion(base, { ...base, manifestSha256: "xyz" })).toBe(false);
    expect(sameStageDCompletion(base, { ...base, classification: "internal" })).toBe(false);
    expect(sameStageDCompletion(base, { ...base, operationId: "op2" })).toBe(false);
  });
});

describe("Item 7 Stage D — CR1: receipt never falsely claims local-only", () => {
  it("a successful sync is genuinely local-only in both decision and receipt", async () => {
    const decision = await syncMemoryAssets(baseInput({ operationId: "op-local-receipt" }), {
      adapter: localAdapter(),
    });
    expect(decision.status).toBe("synced");
    if (decision.status !== "synced") {
      return;
    }
    expect(decision.destinationMode).toBe("local-only");
    expect(decision.receipt.destinationMode).toBe("local-only");
  });

  it("no non-local destination ever yields a synced or local-only receipt", async () => {
    for (const placement of [tenantCloudPlacement(), byosPlacement()]) {
      const custodian = placement.mode === "byos" ? "byos" : "tenant";
      const adapter: StageDSyncAdapter = {
        custodian,
        supportsMode: (m) => m === placement.mode,
        async copy({ manifest }) {
          return { ok: true, writtenSha256: manifest.manifestSha256 };
        },
      };
      const decision = await syncMemoryAssets(
        baseInput({ destinationPlacement: placement, syncPolicy: policy([custodian]) }),
        { adapter },
      );
      expect(decision.status).toBe("denied");
    }
  });
});
