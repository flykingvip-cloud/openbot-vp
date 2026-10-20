/**
 * Item 7 Stage D: controlled memory-asset sync command for the three high-risk
 * `syncMemoryFiles` call-sites (ledger S33/S34/S35) in `manager-sync-ops.ts`.
 *
 * This is a FAIL-CLOSED, DARK/shadow command. It never switches the legacy
 * production sync, never writes the production Catalog, and never performs a
 * real cloud/BYOS copy. Only `local-only` can ever plan or sync; every
 * non-local-only destination is refused UNCONDITIONALLY (no approval escape
 * hatch), so a non-local copy can never execute nor be mislabeled local-only.
 * The controlled semantics (authorize-before-resolve, canonical-handle source,
 * placement/policy destination, receipts, resource-bound operationId idempotency,
 * per-resource fencing, manifest+hash, partial-failure recovery_required,
 * tombstone/revoke propagation, legal hold) are proven via injected fakes in
 * tests only. The default in-memory fencing + recovery sink are dark-slice-only;
 * real sync requires persistent, cross-process stores.
 *
 * Composition (does not reinvent):
 *  - source identity           -> resolveMemoryWorkspaceHandle (authorize-before-resolve)
 *  - branded canonical handle  -> MemoryWorkspaceHandle (no raw path parameter)
 *  - destination/placement     -> PlacementResolverOutput / PlacementPolicy (from resolvePlacement)
 *  - classification            -> DataClassification
 *  - recovery breadcrumb shape -> GovernanceRecoveryReceipt
 *  - dark dual-read gate        -> isItem7W1DarkDualReadEnabled
 *  - index identity proof       -> proveItem7W5IndexIdentity / scheduleItem7W5IndexShadow
 *
 * Does not call syncMemoryFiles, resolveAgentWorkspaceDir, or delete anything.
 */
import { createHash } from "node:crypto";
import type {
  PlacementCustodian,
  PlacementPolicy,
  PlacementResolverOutput,
} from "../gateway/data-governance/placement-resolve.js";
import type { GovernanceRecoveryReceipt } from "../gateway/data-governance/recovery-receipt.js";
import type { DataClassification } from "../gateway/data-governance/types.js";
import { isItem7W1DarkDualReadEnabled } from "./item7-w1-dark-tombstone.js";
import {
  proveItem7W5IndexIdentity,
  scheduleItem7W5IndexShadow,
  type Item7W5IndexProof,
} from "./item7-w5-index-last.js";
// Type-only import keeps this module hermetic: the authorize-before-resolve
// producer (resolveMemoryWorkspaceHandle) is *injected* as a closure, never
// statically imported, so the low-level memory manager stays decoupled from the
// gateway/data-governance graph. The resolver is exercised via tests.
import {
  isMemoryWorkspaceHandle,
  type MemoryWorkspaceHandle,
  type MemoryWorkspaceResolveResult,
} from "./memory-workspace-handle.js";

export const ITEM7_STAGE_D = "item7-stage-d-memory-sync/v1" as const;

/** Ledger site -> the real business phase it serves. The three sites all call
 * `syncMemoryFiles` but are NOT identical; each must be reasoned about apart. */
export type StageDBusinessPhase =
  | "admission-import" // D1/S33: steady-state incremental ingest (runSync)
  | "rebuild-reindex-safe" // D2/S34: full reindex w/ atomic temp-db swap (runSafeReindexInternal)
  | "rebuild-reindex-unsafe"; // D3/S35: in-place reset+reindex, no swap (runUnsafeReindexInternal)

export type StageDSite = {
  ledgerId: "S33" | "S34" | "S35";
  point: "D1" | "D2" | "D3";
  file: "src/memory/manager-sync-ops.ts";
  symbol: "syncMemoryFiles";
  op: "index/sync";
  businessPhase: StageDBusinessPhase;
  /** V1 root-guard operation the enclosing site authorizes under. */
  operationAuth: "sync" | "rebuild";
  /** Rollback posture of the enclosing site (informational, for the receipt). */
  rollback: "convergent-retry" | "atomic-temp-db-swap" | "in-place-reset";
};

export const STAGE_D_SITES: readonly StageDSite[] = [
  {
    ledgerId: "S33",
    point: "D1",
    file: "src/memory/manager-sync-ops.ts",
    symbol: "syncMemoryFiles",
    op: "index/sync",
    businessPhase: "admission-import",
    operationAuth: "sync",
    rollback: "convergent-retry",
  },
  {
    ledgerId: "S34",
    point: "D2",
    file: "src/memory/manager-sync-ops.ts",
    symbol: "syncMemoryFiles",
    op: "index/sync",
    businessPhase: "rebuild-reindex-safe",
    operationAuth: "rebuild",
    rollback: "atomic-temp-db-swap",
  },
  {
    ledgerId: "S35",
    point: "D3",
    file: "src/memory/manager-sync-ops.ts",
    symbol: "syncMemoryFiles",
    op: "index/sync",
    businessPhase: "rebuild-reindex-unsafe",
    operationAuth: "rebuild",
    rollback: "in-place-reset",
  },
];

export function findStageDSite(ledgerId: string): StageDSite | null {
  return STAGE_D_SITES.find((site) => site.ledgerId === ledgerId) ?? null;
}

/**
 * Proof that a decision produced zero physical effects. Reject and plan paths
 * MUST carry all-false. `synced` is the only status allowed to set copied=true,
 * and only local-only ever sets it (cloud/BYOS is fail-closed).
 */
export type StageDSideEffectProof = {
  copied: boolean;
  uploaded: boolean;
  deleted: boolean;
  catalogWrite: boolean;
  hostPathFallback: boolean;
};

export const STAGE_D_NO_SIDE_EFFECTS: StageDSideEffectProof = Object.freeze({
  copied: false,
  uploaded: false,
  deleted: false,
  catalogWrite: false,
  hostPathFallback: false,
});

export type StageDSyncDenyReason =
  | "missing_tenant_context"
  | "missing_actor"
  | "missing_grant"
  | "source_not_canonical_handle"
  | "source_tombstoned"
  | "source_revoked"
  | "legal_hold_forbids_physical_delete"
  | "missing_destination_placement"
  | "missing_sync_policy"
  | "missing_classification"
  | "classification_forbids_sync"
  | "sync_policy_custodian_not_allowed"
  | "destination_adapter_unconfigured"
  | "cloud_sync_not_approved"
  | "byos_not_approved"
  | "cross_tenant"
  | "operation_id_conflict"
  | "concurrent_fencing_conflict"
  | "stale_fencing_token"
  | "hash_mismatch";

export type StageDManifestEntry = {
  path: string;
  bytesSha256: string;
  size: number;
};

export type StageDManifest = {
  entries: readonly StageDManifestEntry[];
  manifestSha256: string;
};

export type StageDSyncReceipt = {
  operationId: string;
  tenantId: string;
  sourceResourceId: string;
  memoryAssetResourceId: string;
  classification: DataClassification;
  destinationMode: StageDDestinationMode;
  manifestSha256: string;
  status: "planned" | "synced";
  createdAt: string;
};

export type StageDDestinationMode = Extract<PlacementResolverOutput, { ok: true }>["mode"];
export type StageDDestinationPlacement = Extract<PlacementResolverOutput, { ok: true }>;

/** The authorized-but-not-executed plan produced before any physical write. */
export type StageDSyncPlan = {
  operationId: string;
  handle: MemoryWorkspaceHandle;
  destinationMode: StageDDestinationMode;
  requiredCustodian: PlacementCustodian;
  classification: DataClassification;
  fenceKey: string;
  fencingToken: string;
};

export type StageDSyncDecision =
  | {
      status: "denied";
      reasonCode: StageDSyncDenyReason;
      reason: string;
      sideEffects: StageDSideEffectProof;
    }
  | {
      // A duplicate operationId whose prior run already synced: no re-copy.
      status: "idempotent-replay";
      operationId: string;
      priorStatus: "synced";
      sideEffects: StageDSideEffectProof;
    }
  | {
      // Fully authorized + planned, but NOT executed (fail-closed / dark default).
      status: "planned";
      operationId: string;
      sourceResourceId: string;
      destinationMode: StageDDestinationMode;
      classification: DataClassification;
      manifest: StageDManifest;
      receipt: StageDSyncReceipt;
      executed: false;
      sideEffects: StageDSideEffectProof;
    }
  | {
      // Real local-only copy that an injected adapter confirmed AND hash-verified.
      status: "synced";
      operationId: string;
      sourceResourceId: string;
      destinationMode: "local-only";
      classification: DataClassification;
      manifest: StageDManifest;
      verifiedSha256: string;
      receipt: StageDSyncReceipt;
      executed: true;
      sideEffects: StageDSideEffectProof;
    }
  | {
      // Partial failure or corrupt copy: halt, write recovery breadcrumb, no double-write.
      status: "recovery-required";
      operationId: string;
      reason: string;
      recoveryReceipt: GovernanceRecoveryReceipt;
      halted: true;
      sideEffects: StageDSideEffectProof;
    };

export type StageDSourceFile = {
  path: string;
  /** Raw bytes of the source file (tests pass fixtures; never a host path to follow). */
  content: Uint8Array | string;
};

/** Result of a physical copy attempt by an adapter. */
export type StageDAdapterCopyResult =
  | { ok: true; writtenSha256: string }
  | { ok: false; partial: boolean; error: string };

/**
 * Destination adapter port. The DEFAULT is fail-closed: it advertises support
 * for nothing and refuses every copy, so production performs zero writes.
 * Tests inject an in-memory local adapter to exercise the copy/verify path.
 */
export type StageDSyncAdapter = {
  readonly custodian: PlacementCustodian;
  supportsMode(mode: StageDDestinationMode): boolean;
  copy(params: {
    operationId: string;
    manifest: StageDManifest;
    files: readonly StageDSourceFile[];
  }): Promise<StageDAdapterCopyResult>;
};

export const FAIL_CLOSED_SYNC_ADAPTER: StageDSyncAdapter = Object.freeze({
  custodian: "device" as PlacementCustodian,
  supportsMode(): boolean {
    return false;
  },
  async copy(): Promise<StageDAdapterCopyResult> {
    return { ok: false, partial: false, error: "fail_closed_adapter_refuses_all_writes" };
  },
});

/**
 * Structured completion record. Idempotency is bound to the full resource
 * identity, NOT just the operationId — two different tenants/resources must
 * never share a replay just because they reused the same operationId string.
 */
export type StageDCompletionRecord = {
  operationId: string;
  tenantId: string;
  sourceResourceId: string;
  destinationMode: StageDDestinationMode;
  manifestSha256: string;
  classification: DataClassification;
};

/** Same operation iff EVERY identity field matches; any divergence is a
 * cross-resource operationId collision, not a replay. */
export function sameStageDCompletion(
  a: StageDCompletionRecord,
  b: StageDCompletionRecord,
): boolean {
  return (
    a.operationId === b.operationId &&
    a.tenantId === b.tenantId &&
    a.sourceResourceId === b.sourceResourceId &&
    a.destinationMode === b.destinationMode &&
    a.manifestSha256 === b.manifestSha256 &&
    a.classification === b.classification
  );
}

/**
 * Fencing + idempotency store.
 *
 * The default (createInMemoryFencingStore) is process-local and NON-durable —
 * valid only for this dark technical slice, which never performs a real
 * production copy. Before any real sync is enabled, this MUST be replaced with a
 * persistent, cross-process fencing + completion store so idempotency and
 * single-flight survive restarts and hold across workers.
 */
export type StageDFencingStore = {
  tryAcquire(
    key: string,
    operationId: string,
    fencingToken: string,
  ): { acquired: true } | { acquired: false; reason: "concurrent" | "stale_token" };
  /** The stored completion record for an operationId, or null if none. */
  completedRecord(operationId: string): StageDCompletionRecord | null;
  markCompleted(record: StageDCompletionRecord): void;
  release(key: string): void;
};

export function createInMemoryFencingStore(): StageDFencingStore {
  const held = new Map<string, { operationId: string; fencingToken: string }>();
  const completed = new Map<string, StageDCompletionRecord>();
  return {
    tryAcquire(key, operationId, fencingToken) {
      const existing = held.get(key);
      if (existing && existing.operationId !== operationId) {
        return { acquired: false, reason: "concurrent" };
      }
      if (existing && existing.fencingToken !== fencingToken) {
        return { acquired: false, reason: "stale_token" };
      }
      held.set(key, { operationId, fencingToken });
      return { acquired: true };
    },
    completedRecord(operationId) {
      return completed.get(operationId) ?? null;
    },
    markCompleted(record) {
      completed.set(record.operationId, record);
    },
    release(key) {
      held.delete(key);
    },
  };
}

export type StageDRecoverySink = (params: {
  operationId: string;
  stage: string;
  reason: string;
  error?: string;
  resourceIds?: string[];
}) => GovernanceRecoveryReceipt;

/** Default recovery sink: builds the breadcrumb in-memory. It does NOT touch
 * disk, so the dark/production path writes nothing — valid only for this dark
 * slice. Before any real sync is enabled, inject a persistent, cross-process
 * sink backed by writeGovernanceRecoveryReceipt(stateDir); tests already do so
 * to prove durability. */
export function inMemoryRecoverySink(params: {
  operationId: string;
  stage: string;
  reason: string;
  error?: string;
  resourceIds?: string[];
}): GovernanceRecoveryReceipt {
  return {
    operationId: params.operationId,
    stage: params.stage,
    reason: params.reason,
    error: params.error,
    resourceIds: params.resourceIds,
    haltCompensation: true,
    createdAt: new Date().toISOString(),
  };
}

export type SyncMemoryAssetsInput = {
  tenantContext: { tenantId: string } | null;
  actor: { tenantId: string; userId: string } | null;
  /** Restricted canonical handle. A raw path / non-branded object is refused. */
  sourceHandle: unknown;
  destinationPlacement: StageDDestinationPlacement | null;
  syncPolicy: PlacementPolicy | null;
  classification: DataClassification | null;
  operationId: string;
  legalHoldActive?: boolean;
  /** Physical delete is never part of sync; a delete intent under legal hold is refused. */
  intendsPhysicalDelete?: boolean;
  sourceState?: { tombstoned?: boolean; revoked?: boolean };
  /** Present only when a real copy is attempted (tests). Never read as a host path. */
  files?: readonly StageDSourceFile[];
};

export type SyncMemoryAssetsPorts = {
  adapter?: StageDSyncAdapter;
  fencing?: StageDFencingStore;
  recoverySink?: StageDRecoverySink;
  now?: () => string;
  // NOTE: there is deliberately NO cloud/BYOS approval flag. In this dark slice,
  // every non-local-only destination is unconditionally fail-closed. Cloud/BYOS
  // sync (its receipt shape and adapter contract) must be redesigned in a
  // dedicated future stage; an approval escape hatch here would let a non-local
  // copy execute yet be recorded as local-only.
};

function denied(
  reasonCode: StageDSyncDenyReason,
  reason: string,
): Extract<StageDSyncDecision, { status: "denied" }> {
  return { status: "denied", reasonCode, reason, sideEffects: STAGE_D_NO_SIDE_EFFECTS };
}

const CUSTODIAN_BY_MODE: Record<StageDDestinationMode, PlacementCustodian> = {
  "local-only": "device",
  "encrypted-cloud": "openbot",
  "tenant-cloud": "tenant",
  dedicated: "tenant",
  byos: "byos",
  "cold-archive": "openbot",
};

/** restricted data may only live locally; every off-device mode is refused. */
function classificationPermitsMode(
  classification: DataClassification,
  mode: StageDDestinationMode,
): boolean {
  if (classification === "restricted") {
    return mode === "local-only";
  }
  return true;
}

export function computeStageDManifest(files: readonly StageDSourceFile[]): StageDManifest {
  const entries = files
    .map((file) => {
      const bytes =
        typeof file.content === "string" ? Buffer.from(file.content, "utf8") : file.content;
      return {
        path: file.path,
        bytesSha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
      };
    })
    .toSorted((a, b) => a.path.localeCompare(b.path));
  const manifestSha256 = createHash("sha256")
    .update(entries.map((entry) => `${entry.path}:${entry.bytesSha256}:${entry.size}`).join("\n"))
    .digest("hex");
  return { entries, manifestSha256 };
}

/**
 * Authorize + resolve + validate, WITHOUT executing. Returns a deny decision or
 * a ready plan. All deny paths are side-effect free by construction.
 */
export function planMemoryAssetSync(
  input: SyncMemoryAssetsInput,
): Extract<StageDSyncDecision, { status: "denied" }> | { ok: true; plan: StageDSyncPlan } {
  // (1) authorize-before-resolve: tenant + actor + grant must be present first.
  if (!input.tenantContext || !input.tenantContext.tenantId.trim()) {
    return denied("missing_tenant_context", "tenantContext.tenantId is required");
  }
  if (!input.actor || !input.actor.tenantId.trim() || !input.actor.userId.trim()) {
    return denied("missing_actor", "actor.tenantId and actor.userId are required");
  }
  if (input.actor.tenantId !== input.tenantContext.tenantId) {
    return denied("cross_tenant", "actor tenantId does not match tenantContext tenantId");
  }
  // (2) source must be a branded canonical handle — never a raw path.
  if (!isMemoryWorkspaceHandle(input.sourceHandle)) {
    return denied(
      "source_not_canonical_handle",
      "sourceHandle must be a branded MemoryWorkspaceHandle (no raw path)",
    );
  }
  const handle = input.sourceHandle;
  if (handle.tenantId !== input.tenantContext.tenantId) {
    return denied("cross_tenant", "handle tenantId does not match tenantContext tenantId");
  }
  // A dark handle carries search+export only; the grant to sync must be present.
  if (!handle.permissions.export) {
    return denied("missing_grant", "handle lacks the export grant required to sync");
  }
  // (13) tombstone / revoke propagation: a retired source never syncs forward.
  if (input.sourceState?.tombstoned) {
    return denied("source_tombstoned", "source is tombstoned; sync is refused");
  }
  if (input.sourceState?.revoked) {
    return denied("source_revoked", "source is revoked; sync is refused");
  }
  if (handle.lifecycle === "retired" || handle.lifecycle === "purged") {
    return denied("source_tombstoned", `source lifecycle=${handle.lifecycle}; sync is refused`);
  }
  // (14) legal hold forbids physical delete (sync itself never deletes).
  if (input.legalHoldActive && input.intendsPhysicalDelete) {
    return denied(
      "legal_hold_forbids_physical_delete",
      "legal hold forbids physical delete during sync",
    );
  }
  // (3) destination is decided by placement + sync policy — not by a path arg.
  if (!input.destinationPlacement) {
    return denied("missing_destination_placement", "destinationPlacement is required");
  }
  if (!input.syncPolicy) {
    return denied("missing_sync_policy", "syncPolicy is required");
  }
  if (!input.classification) {
    return denied("missing_classification", "classification is required");
  }
  const mode = input.destinationPlacement.mode;
  if (!classificationPermitsMode(input.classification, mode)) {
    return denied(
      "classification_forbids_sync",
      `classification=${input.classification} forbids destination mode=${mode}`,
    );
  }
  const requiredCustodian = CUSTODIAN_BY_MODE[mode];
  if (!input.syncPolicy.allowedCustodians.includes(requiredCustodian)) {
    return denied(
      "sync_policy_custodian_not_allowed",
      `sync policy does not allow custodian=${requiredCustodian} for mode=${mode}`,
    );
  }
  const fencingToken = handle.fencingToken;
  if (!fencingToken.trim()) {
    return denied("stale_fencing_token", "handle fencingToken is required for fencing");
  }
  return {
    ok: true,
    plan: {
      operationId: input.operationId,
      handle,
      destinationMode: mode,
      requiredCustodian,
      classification: input.classification,
      fenceKey: `memory-sync:${handle.resourceId}`,
      fencingToken,
    },
  };
}

function buildReceipt(
  plan: StageDSyncPlan,
  manifestSha256: string,
  status: "planned" | "synced",
  now: () => string,
): StageDSyncReceipt {
  return {
    operationId: plan.operationId,
    tenantId: plan.handle.tenantId,
    sourceResourceId: plan.handle.resourceId,
    memoryAssetResourceId: plan.handle.memoryAssetResourceId,
    classification: plan.classification,
    destinationMode: plan.destinationMode,
    manifestSha256,
    status,
    createdAt: now(),
  };
}

/**
 * Controlled memory-asset sync. Fail-closed: it plans and (only with a supporting
 * local adapter) executes a verified local-only copy. Every non-local-only
 * destination (encrypted-cloud / tenant-cloud / dedicated / byos / cold-archive)
 * is refused unconditionally — there is no cloud/BYOS approval path in this slice.
 * It never fabricates a "synced" status and never deletes.
 */
export async function syncMemoryAssets(
  input: SyncMemoryAssetsInput,
  ports: SyncMemoryAssetsPorts = {},
): Promise<StageDSyncDecision> {
  const now = ports.now ?? (() => new Date().toISOString());
  if (!input.operationId.trim()) {
    return denied("operation_id_conflict", "operationId is required");
  }

  const planned = planMemoryAssetSync(input);
  if ("status" in planned) {
    return planned;
  }
  const { plan } = planned;

  // (15) Non-local-only destinations are UNCONDITIONALLY fail-closed in this dark
  // slice — there is no approval escape hatch. Cloud/BYOS sync (its receipt shape
  // and adapter contract) must be redesigned in a dedicated future stage. An
  // approval flag here would let a non-local copy execute yet be recorded as local.
  if (plan.destinationMode !== "local-only") {
    const reasonCode: StageDSyncDenyReason =
      plan.destinationMode === "byos" ? "byos_not_approved" : "cloud_sync_not_approved";
    return denied(
      reasonCode,
      `destination mode=${plan.destinationMode} is not permitted in this stage; only local-only is allowed (fail-closed)`,
    );
  }
  // plan.destinationMode is now narrowed to "local-only" — the only mode that can
  // plan or sync in this slice. Capture it so the success receipt inherits it
  // (never fabricates local-only).
  const localMode = plan.destinationMode;

  // (8) manifest + hash BEFORE any copy — and before the idempotency comparison,
  // which is keyed on the manifest hash + resource identity.
  const manifest = computeStageDManifest(input.files ?? []);

  // Resource-bound completion descriptor: idempotency is tied to the full
  // identity, never to the operationId string alone.
  const completion: StageDCompletionRecord = {
    operationId: plan.operationId,
    tenantId: plan.handle.tenantId,
    sourceResourceId: plan.handle.resourceId,
    destinationMode: localMode,
    manifestSha256: manifest.manifestSha256,
    classification: plan.classification,
  };

  const fencing = ports.fencing ?? createInMemoryFencingStore();

  // (6) operationId idempotency: replay ONLY when every identity field matches. A
  // same-operationId call for a different tenant/resource/manifest/mode/class is
  // an operationId collision -> conflict, never a cross-resource replay.
  const prior = fencing.completedRecord(plan.operationId);
  if (prior) {
    if (sameStageDCompletion(prior, completion)) {
      return {
        status: "idempotent-replay",
        operationId: plan.operationId,
        priorStatus: "synced",
        sideEffects: STAGE_D_NO_SIDE_EFFECTS,
      };
    }
    return denied(
      "operation_id_conflict",
      `operationId ${plan.operationId} already completed for a different resource/manifest; refusing cross-resource replay`,
    );
  }

  // (7) exclusive per-resource fencing: concurrent same-resource sync is refused.
  const acquired = fencing.tryAcquire(plan.fenceKey, plan.operationId, plan.fencingToken);
  if (!acquired.acquired) {
    return acquired.reason === "stale_token"
      ? denied("stale_fencing_token", "fencing token is stale; another op advanced the resource")
      : denied("concurrent_fencing_conflict", "another operation holds the resource fence");
  }

  try {
    // Without a real supporting adapter there is no physical destination -> plan only.
    const adapter = ports.adapter ?? FAIL_CLOSED_SYNC_ADAPTER;
    if (!adapter.supportsMode(localMode)) {
      // Fail-closed: authorized + planned, but not executed. Zero side effects.
      return {
        status: "planned",
        operationId: plan.operationId,
        sourceResourceId: plan.handle.resourceId,
        destinationMode: localMode,
        classification: plan.classification,
        manifest,
        receipt: buildReceipt(plan, manifest.manifestSha256, "planned", now),
        executed: false,
        sideEffects: STAGE_D_NO_SIDE_EFFECTS,
      };
    }
    if (adapter.custodian !== plan.requiredCustodian) {
      return denied(
        "destination_adapter_unconfigured",
        `adapter custodian=${adapter.custodian} does not match required=${plan.requiredCustodian}`,
      );
    }

    // Execute the copy through the injected adapter (tests only).
    const result = await adapter.copy({
      operationId: plan.operationId,
      manifest,
      files: input.files ?? [],
    });

    if (!result.ok) {
      // (10) partial failure -> recovery_required + halt; clean failure -> deny (retryable).
      if (result.partial) {
        const recoveryReceipt = (ports.recoverySink ?? inMemoryRecoverySink)({
          operationId: plan.operationId,
          stage: "memory_stage_d_sync",
          reason: "partial_copy_failure",
          error: result.error,
          resourceIds: [plan.handle.resourceId],
        });
        return {
          status: "recovery-required",
          operationId: plan.operationId,
          reason: "partial_copy_failure",
          recoveryReceipt,
          halted: true,
          sideEffects: { ...STAGE_D_NO_SIDE_EFFECTS, copied: true },
        };
      }
      return denied("destination_adapter_unconfigured", `copy refused: ${result.error}`);
    }

    // (9) verify hash AFTER copy. A mismatch is a corrupt copy -> recovery, never "synced".
    if (result.writtenSha256 !== manifest.manifestSha256) {
      const recoveryReceipt = (ports.recoverySink ?? inMemoryRecoverySink)({
        operationId: plan.operationId,
        stage: "memory_stage_d_sync",
        reason: "hash_mismatch",
        error: `expected ${manifest.manifestSha256}, wrote ${result.writtenSha256}`,
        resourceIds: [plan.handle.resourceId],
      });
      return {
        status: "recovery-required",
        operationId: plan.operationId,
        reason: "hash_mismatch",
        recoveryReceipt,
        halted: true,
        sideEffects: { ...STAGE_D_NO_SIDE_EFFECTS, copied: true },
      };
    }

    // Only local-only reaches here; the receipt inherits the mode from the plan
    // and the completion record is resource-bound.
    fencing.markCompleted(completion);
    return {
      status: "synced",
      operationId: plan.operationId,
      sourceResourceId: plan.handle.resourceId,
      destinationMode: localMode,
      classification: plan.classification,
      manifest,
      verifiedSha256: result.writtenSha256,
      receipt: buildReceipt(plan, manifest.manifestSha256, "synced", now),
      executed: true,
      sideEffects: { ...STAGE_D_NO_SIDE_EFFECTS, copied: true },
    };
  } finally {
    fencing.release(plan.fenceKey);
  }
}

// ---------------------------------------------------------------------------
// Dark shadow wiring for the three call-sites. Env-gated + fire-and-forget.
// ---------------------------------------------------------------------------

export type StageDShadowProof = {
  ledgerId: string;
  businessPhase: StageDBusinessPhase;
  handleResourceId: string | null;
  indexIdentity: Item7W5IndexProof | null;
  controlledSync: StageDSyncDecision;
  productionWrite: "legacy-only";
};

export type StageDShadowInput = {
  ledgerId: "S33" | "S34" | "S35";
  businessPhase: StageDBusinessPhase;
  /** Best-effort read-only resolve of the source identity (inject the real
   * resolveMemoryWorkspaceHandle here). Optional so the hot sync path never
   * requires tenant context; absent => catalog miss (the safe default). */
  resolveHandle?: () => Promise<MemoryWorkspaceResolveResult>;
  env?: NodeJS.ProcessEnv;
};

/**
 * Runs the Stage D dark proof: resolve the canonical handle (read-only),
 * forward its identity to the W5 index proof, and compute the fail-closed
 * controlled-sync decision. Returns null when the dark dual-read flag is off.
 * Never throws into the caller and never writes production state.
 */
export async function runItem7StageDMemorySyncShadow(
  input: StageDShadowInput,
): Promise<StageDShadowProof | null> {
  if (!isItem7W1DarkDualReadEnabled(input.env ?? process.env)) {
    return null;
  }
  let handleResourceId: string | null = null;
  let sourceHandle: unknown = null;
  let tenantId: string | null = null;
  try {
    if (input.resolveHandle) {
      const resolved = await input.resolveHandle();
      if (resolved.ok) {
        handleResourceId = resolved.handle.resourceId;
        sourceHandle = resolved.handle;
        tenantId = resolved.handle.tenantId;
      }
    }
  } catch {
    // Read-only resolve must never break sync; treat any failure as a catalog miss.
    handleResourceId = null;
    sourceHandle = null;
    tenantId = null;
  }

  const indexIdentity = proveItem7W5IndexIdentity({
    ledgerId: input.ledgerId,
    handleResourceId,
  });
  // Preserve the existing W5 index shadow schedule (now with a real id when present).
  scheduleItem7W5IndexShadow({ ledgerId: input.ledgerId, handleResourceId });

  // Controlled-sync decision under the fail-closed default adapter: proves the
  // command is wired and refuses (no tenant/handle in production => denied).
  const controlledSync = await syncMemoryAssets({
    tenantContext: tenantId ? { tenantId } : null,
    actor: null,
    sourceHandle,
    destinationPlacement: null,
    syncPolicy: null,
    classification: null,
    operationId: `stage-d-shadow-${input.ledgerId}`,
  });

  return {
    ledgerId: input.ledgerId,
    businessPhase: input.businessPhase,
    handleResourceId,
    indexIdentity,
    controlledSync,
    productionWrite: "legacy-only",
  };
}

/** Fire-and-forget entry used at the three call-sites (comma-operator friendly). */
export function scheduleItem7StageDMemorySyncShadow(input: StageDShadowInput): void {
  void runItem7StageDMemorySyncShadow(input);
}
