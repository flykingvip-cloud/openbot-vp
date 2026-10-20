import { resolveStateDir } from "../../config/paths.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import { resourceHasActiveAnchor } from "./cognitive-anchor-store.js";
import {
  approvalAuditFrom,
  isGovernanceApprovalAuth,
  type GovernanceApprovalAuth,
} from "./cognitive-approval-auth.js";
import { approvalScopeFingerprint } from "./cognitive-approval-grant-store.js";
import { runConflictGraphTakeover } from "./cognitive-conflict-graph-takeover.js";
import {
  acquireMergeReservation,
  isReservationLeaseExpired,
  markReservationDerivedCreated,
  openConflictEdgesTouching,
  readConflictGraphHead,
  releaseMergeReservation,
  resolveActionClock,
  type GovernanceActionClock,
} from "./cognitive-conflict-graph.js";
import {
  CognitiveMergeCrashError,
  beginMergeStep,
  endMergeStep,
} from "./cognitive-merge-fault-slot.js";
import {
  mergeProtectedCompareAndPut,
  uniqueCreateDerivedMemory,
} from "./cognitive-merge-fencing.js";
import {
  computeCognitiveMergeFingerprint,
  createCognitiveMergeReceiptUnique,
  getCognitiveMergeReceipt,
  putCognitiveMergeReceipt,
} from "./cognitive-merge-receipt-store.js";
import { isCognitiveWriteUnlocked } from "./cognitive-write-unlock.js";
import { isLegalHoldActive } from "./envelope.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type {
  CatalogRecord,
  CognitiveMergeDenyCode,
  CognitiveMergeReceipt,
  DataGovernanceEnvelope,
} from "./types.js";
import { assertOwnershipProofMatches } from "./write-gate.js";

const BLOCKED_LIFECYCLES = new Set([
  "purged",
  "deletion_pending",
  "recovery_required",
  "quarantined",
]);

export type ApplyCognitiveMergeParams = {
  mergeId: string;
  targetResourceId: string;
  sourceResourceIds: string[];
  expectedGovernanceVersion: number;
  expectedConflictGraphVersion: number;
  expectedConflictGraphHash: string;
  policyVersion: string;
  auth: GovernanceApprovalAuth;
  derivedMemoryResourceId?: string;
  now?: Date;
  clock?: GovernanceActionClock;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

export type ApplyCognitiveMergeResult =
  | { ok: true; receipt: CognitiveMergeReceipt; target: CatalogRecord; derived: CatalogRecord }
  | { ok: false; error: CognitiveMergeDenyCode; receipt?: CognitiveMergeReceipt };

function catalogFor(params: {
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
}): DataGovernanceCatalogStore {
  if (params.catalog) {
    return params.catalog;
  }
  return getOrCreateFileDataGovernanceCatalogStore({
    storePath: resolveDataGovernanceCatalogPath(params.stateDir ?? resolveStateDir()),
  });
}

function denyLifecycle(envelope: DataGovernanceEnvelope): CognitiveMergeDenyCode | null {
  if (envelope.resourceType !== "memory") {
    return "command_denied_for_type";
  }
  if (BLOCKED_LIFECYCLES.has(envelope.lifecycleState)) {
    return "lifecycle_blocks_write";
  }
  if (envelope.activeLifecycleOperation) {
    return "active_operation_blocks_write";
  }
  if (isLegalHoldActive(envelope)) {
    return "actor_not_authorized";
  }
  return null;
}

/** Re-bind branded auth to the actual Catalog row — never trust mint-time requiredScope alone. */
function denyUnboundParticipant(
  record: CatalogRecord | null,
  auth: GovernanceApprovalAuth,
): CognitiveMergeDenyCode | null {
  if (!record) {
    return "not_found";
  }
  if (record.envelope.tenantId !== auth.callerTenantId) {
    return "actor_not_authorized";
  }
  if (record.envelope.tenantId !== auth.approvalGrant.tenantId) {
    return "actor_not_authorized";
  }
  try {
    assertOwnershipProofMatches(record, auth.ownershipProof);
  } catch {
    return "actor_not_authorized";
  }
  return denyLifecycle(record.envelope);
}

function grantScopeMatchesTarget(auth: GovernanceApprovalAuth, targetResourceId: string): boolean {
  return (
    approvalScopeFingerprint(auth.approvalGrant.scope) ===
    approvalScopeFingerprint({ kind: "resource", resourceId: targetResourceId })
  );
}

function mapFence(conflict: string): CognitiveMergeDenyCode {
  if (conflict === "fenced_stale_token") {
    return "fenced_stale_token";
  }
  if (conflict === "fenced_stale_graph_epoch") {
    return "fenced_stale_graph_epoch";
  }
  if (conflict === "merge_in_flight") {
    return "merge_in_flight";
  }
  if (conflict === "version_conflict") {
    return "version_conflict";
  }
  return "version_conflict";
}

function buildDerivedRow(params: {
  target: CatalogRecord;
  derivedMemoryResourceId: string;
  mergeId: string;
  fencingToken: number;
  conflictGraphEpoch: number;
  now: string;
}): CatalogRecord {
  const src = params.target.envelope;
  return {
    envelope: {
      resourceId: params.derivedMemoryResourceId,
      resourceType: "memory",
      schemaVersion: 2,
      tenantId: src.tenantId,
      owner: src.owner,
      scope: src.scope,
      lifecycleState: "pending",
      classification: src.classification,
      governanceVersion: 1,
      canonicalBindingId: `bind-${params.derivedMemoryResourceId}`,
      createdAt: params.now,
      updatedAt: params.now,
      projection: {
        derivedRole: "merge_consolidation",
        mergeReceiptId: params.mergeId,
      },
      retrievalGovernance: {
        eligibility: "blocked",
        basePriority: 0,
        freshnessPolicyId: src.retrievalGovernance?.freshnessPolicyId ?? "freshness-default",
        applicabilityPolicyId:
          src.retrievalGovernance?.applicabilityPolicyId ?? "applicability-default",
      },
      mergeFinalizationState: "pending_finalization",
      lastAcceptedFencingToken: params.fencingToken,
      lastAcceptedConflictGraphEpoch: params.conflictGraphEpoch,
    },
    bindings: [
      {
        bindingId: `bind-${params.derivedMemoryResourceId}`,
        resourceId: params.derivedMemoryResourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `/data/${params.derivedMemoryResourceId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

async function persistReceipt(
  receipt: CognitiveMergeReceipt,
  stateDir: string,
): Promise<CognitiveMergeReceipt> {
  return putCognitiveMergeReceipt({ receipt, stateDir });
}

export async function applyCognitiveMerge(
  params: ApplyCognitiveMergeParams,
): Promise<ApplyCognitiveMergeResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const catalog = catalogFor(params);
  const clock = resolveActionClock(params);
  const now = clock();

  if (!isGovernanceApprovalAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (params.auth.approvalGrant.grantKind !== "cognitive_merge_apply") {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isCognitiveWriteUnlocked(stateDir)) {
    return { ok: false, error: "schema_write_locked" };
  }
  if (!params.mergeId || params.sourceResourceIds.length === 0) {
    return { ok: false, error: "invalid_merge_request" };
  }

  const existing = getCognitiveMergeReceipt({
    mergeId: params.mergeId,
    tenantId: params.auth.callerTenantId,
    stateDir,
  });
  if (existing) {
    if (existing.status === "applied") {
      const target = await catalog.get(existing.targetResourceId);
      const derived = existing.derivedMemoryResourceId
        ? await catalog.get(existing.derivedMemoryResourceId)
        : null;
      if (target && derived) {
        return { ok: true, receipt: existing, target, derived };
      }
    }
    if (existing.status === "needs_recovery") {
      return { ok: false, error: "needs_recovery", receipt: existing };
    }
    if (
      existing.status === "conflicted" ||
      existing.status === "failed" ||
      existing.status === "rejected"
    ) {
      return { ok: false, error: existing.status, receipt: existing };
    }
  }

  if (!grantScopeMatchesTarget(params.auth, params.targetResourceId)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const target = await catalog.get(params.targetResourceId);
  const targetDenied = denyUnboundParticipant(target, params.auth);
  if (targetDenied || !target) {
    return { ok: false, error: targetDenied ?? "not_found" };
  }
  if (target.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, error: "version_conflict" };
  }
  if (resourceHasActiveAnchor({ resourceId: params.targetResourceId, stateDir })) {
    return { ok: false, error: "active_anchor_blocks_merge" };
  }

  for (const sourceResourceId of params.sourceResourceIds) {
    const source = await catalog.get(sourceResourceId);
    const sourceDenied = denyUnboundParticipant(source, params.auth);
    if (sourceDenied) {
      return { ok: false, error: sourceDenied };
    }
    if (resourceHasActiveAnchor({ resourceId: sourceResourceId, stateDir })) {
      return { ok: false, error: "active_anchor_blocks_merge" };
    }
  }

  const fingerprint = computeCognitiveMergeFingerprint({
    targetResourceId: params.targetResourceId,
    sourceResourceIds: params.sourceResourceIds,
    policyVersion: params.policyVersion,
    expectedConflictGraphHash: params.expectedConflictGraphHash,
  });
  const derivedMemoryResourceId = params.derivedMemoryResourceId ?? `mem-merge-${params.mergeId}`;
  const prepared: CognitiveMergeReceipt = {
    mergeId: params.mergeId,
    kind: "cognitive_merge_receipt",
    status: "prepared",
    tenantId: params.auth.callerTenantId,
    targetResourceId: params.targetResourceId,
    sourceResourceIds: [...params.sourceResourceIds],
    preservedSourceLinkIds: [...params.sourceResourceIds],
    derivedMemoryResourceId,
    conflictEdgeIds: [],
    policyVersion: params.policyVersion,
    requestFingerprint: fingerprint,
    expectedConflictGraphVersion: params.expectedConflictGraphVersion,
    expectedConflictGraphHash: params.expectedConflictGraphHash,
    requestedByAudit: { actor: params.auth.actor, requestedAt: now.toISOString() },
    approvalAudit: approvalAuditFrom(params.auth, now),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const created = existing
    ? { ok: true as const, receipt: existing }
    : await createCognitiveMergeReceiptUnique({ receipt: prepared, stateDir });
  let receipt = created.ok ? created.receipt : created.existing;
  if (!created.ok && created.existing.requestFingerprint !== fingerprint) {
    return { ok: false, error: "idempotent_mismatch", receipt: created.existing };
  }

  try {
    return await runMergeProtocol({
      params,
      catalog,
      stateDir,
      now,
      clock,
      receipt,
      target,
      derivedMemoryResourceId,
    });
  } catch (err) {
    if (err instanceof CognitiveMergeCrashError) {
      const latest = getCognitiveMergeReceipt({
        mergeId: params.mergeId,
        tenantId: params.auth.callerTenantId,
        stateDir,
      });
      return { ok: false, error: "needs_recovery", receipt: latest ?? receipt };
    }
    throw err;
  }
}

async function runMergeProtocol(params: {
  params: ApplyCognitiveMergeParams;
  catalog: DataGovernanceCatalogStore;
  stateDir: string;
  now: Date;
  clock: GovernanceActionClock;
  receipt: CognitiveMergeReceipt;
  target: CatalogRecord;
  derivedMemoryResourceId: string;
}): Promise<ApplyCognitiveMergeResult> {
  const { catalog, stateDir, now, clock } = params;
  const tenantId = params.params.auth.callerTenantId;
  const mergeId = params.params.mergeId;
  let receipt = params.receipt;

  await beginMergeStep("S1");
  const acquired = await acquireMergeReservation({
    tenantId,
    stateDir,
    mergeId,
    targetResourceId: params.params.targetResourceId,
    sourceResourceIds: params.params.sourceResourceIds,
    derivedMemoryResourceId: params.derivedMemoryResourceId,
    now,
  });
  if (!acquired.ok) {
    receipt = await persistReceipt(
      { ...receipt, status: "conflicted", reasonCode: acquired.conflict },
      stateDir,
    );
    return { ok: false, error: acquired.conflict, receipt };
  }
  const reservation = acquired.reservation;
  const holder = acquired.holder;
  receipt = await persistReceipt(
    {
      ...receipt,
      fencingToken: reservation.fencingToken,
      conflictGraphEpoch: reservation.reservedGraphEpoch,
      derivedMemoryResourceId: reservation.derivedMemoryResourceId,
      protocolPhase: "S1",
      derivedCreated: false,
    },
    stateDir,
  );

  const release = async () =>
    releaseMergeReservation({
      tenantId,
      stateDir,
      holder,
      clock,
    });

  const markDerivedCreated = async (): Promise<ApplyCognitiveMergeResult | null> => {
    const marked = await markReservationDerivedCreated({
      tenantId,
      stateDir,
      holder,
      clock,
    });
    if (!marked.ok) {
      await release();
      receipt = await persistReceipt(
        { ...receipt, status: "conflicted", reasonCode: marked.conflict },
        stateDir,
      );
      return { ok: false, error: "conflict_graph_reserved", receipt };
    }
    receipt = await persistReceipt(
      { ...receipt, derivedCreated: true, protocolPhase: receipt.protocolPhase ?? "S3" },
      stateDir,
    );
    return null;
  };

  try {
    await endMergeStep("S1");
    await beginMergeStep("S1b");
    const liveTarget = (await catalog.get(params.params.targetResourceId)) ?? params.target;
    const claim = await mergeProtectedCompareAndPut({
      catalog,
      resourceId: liveTarget.envelope.resourceId,
      expectedGovernanceVersion: liveTarget.envelope.governanceVersion,
      fencingToken: reservation.fencingToken,
      conflictGraphEpoch: reservation.reservedGraphEpoch,
      mergeId,
      mutate: (row) => row,
    });
    if (!claim.ok) {
      await release();
      receipt = await persistReceipt(
        { ...receipt, status: "conflicted", reasonCode: claim.conflict },
        stateDir,
      );
      return { ok: false, error: mapFence(claim.conflict), receipt };
    }
    const existingDerived = await catalog.get(reservation.derivedMemoryResourceId);
    if (existingDerived) {
      const claimDerived = await mergeProtectedCompareAndPut({
        catalog,
        resourceId: existingDerived.envelope.resourceId,
        expectedGovernanceVersion: existingDerived.envelope.governanceVersion,
        fencingToken: reservation.fencingToken,
        conflictGraphEpoch: reservation.reservedGraphEpoch,
        mergeId,
        mutate: (row) => row,
      });
      if (!claimDerived.ok) {
        await release();
        receipt = await persistReceipt(
          { ...receipt, status: "conflicted", reasonCode: claimDerived.conflict },
          stateDir,
        );
        return { ok: false, error: mapFence(claimDerived.conflict), receipt };
      }
      const markedExisting = await markDerivedCreated();
      if (markedExisting) {
        return markedExisting;
      }
    }

    receipt = await persistReceipt({ ...receipt, protocolPhase: "S1b" }, stateDir);
    await endMergeStep("S1b");
    await beginMergeStep("S2");
    const head = readConflictGraphHead({ tenantId, stateDir });
    if (reservation.reservedGraphHash !== params.params.expectedConflictGraphHash) {
      await release();
      receipt = await persistReceipt(
        { ...receipt, status: "conflicted", reasonCode: "conflict_graph_stale" },
        stateDir,
      );
      return { ok: false, error: "conflict_graph_stale", receipt };
    }
    const blocking = openConflictEdgesTouching({
      resourceIds: [params.params.targetResourceId, ...params.params.sourceResourceIds],
      tenantId,
      stateDir,
    });
    if (blocking.length > 0 || head.graphHash !== reservation.reservedGraphHash) {
      await release();
      receipt = await persistReceipt(
        { ...receipt, status: "conflicted", reasonCode: "conflict_open_blocks_merge" },
        stateDir,
      );
      return { ok: false, error: "conflict_open_blocks_merge", receipt };
    }

    receipt = await persistReceipt({ ...receipt, protocolPhase: "S2" }, stateDir);
    await endMergeStep("S2");
    await beginMergeStep("S3");
    // Marker before create: a crash must not leave a derived row with derivedCreated=false.
    const marked = await markDerivedCreated();
    if (marked) {
      return marked;
    }
    receipt = await persistReceipt(
      { ...receipt, protocolPhase: "S3", derivedCreated: true },
      stateDir,
    );
    await endMergeStep("S3_intent");
    let derived = await catalog.get(reservation.derivedMemoryResourceId);
    if (!derived) {
      const created = await uniqueCreateDerivedMemory({
        catalog,
        record: buildDerivedRow({
          target: claim.record,
          derivedMemoryResourceId: reservation.derivedMemoryResourceId,
          mergeId,
          fencingToken: reservation.fencingToken,
          conflictGraphEpoch: reservation.reservedGraphEpoch,
          now: now.toISOString(),
        }),
      });
      if (!created.ok) {
        await release();
        receipt = await persistReceipt(
          { ...receipt, status: "failed", reasonCode: "derived_create_failed" },
          stateDir,
        );
        return { ok: false, error: "derived_create_failed", receipt };
      }
      derived = created.record;
    }
    await endMergeStep("S3");
    await beginMergeStep("S4");
    const attachBase = (await catalog.get(params.params.targetResourceId))!;
    const attach = await mergeProtectedCompareAndPut({
      catalog,
      resourceId: attachBase.envelope.resourceId,
      expectedGovernanceVersion: attachBase.envelope.governanceVersion,
      fencingToken: reservation.fencingToken,
      conflictGraphEpoch: reservation.reservedGraphEpoch,
      mergeId,
      mutate: (row) => ({
        ...row,
        envelope: {
          ...row.envelope,
          activeCognitiveMergeOp: {
            mergeId,
            fencingToken: reservation.fencingToken,
            derivedMemoryResourceId: reservation.derivedMemoryResourceId,
            conflictGraphEpoch: reservation.reservedGraphEpoch,
            state: "attaching",
            expiresAt: reservation.leaseExpiresAt,
          },
        },
      }),
    });
    if (!attach.ok) {
      await release();
      receipt = await persistReceipt(
        { ...receipt, status: "conflicted", reasonCode: attach.conflict },
        stateDir,
      );
      return { ok: false, error: mapFence(attach.conflict), receipt };
    }
    receipt = await persistReceipt(
      {
        ...receipt,
        attachedTargetVersion: attach.record.envelope.governanceVersion,
        protocolPhase: "S4",
        derivedCreated: true,
      },
      stateDir,
    );

    await endMergeStep("S4");
    const derivedLive = (await catalog.get(reservation.derivedMemoryResourceId))!;
    let activated: Awaited<ReturnType<typeof mergeProtectedCompareAndPut>>;
    try {
      await beginMergeStep("S5");
      activated = await mergeProtectedCompareAndPut({
        catalog,
        resourceId: derivedLive.envelope.resourceId,
        expectedGovernanceVersion: derivedLive.envelope.governanceVersion,
        fencingToken: reservation.fencingToken,
        conflictGraphEpoch: reservation.reservedGraphEpoch,
        mergeId,
        mutate: (row) => ({
          ...row,
          envelope: {
            ...row.envelope,
            lifecycleState: "active",
            retrievalGovernance: {
              ...(row.envelope.retrievalGovernance ?? {
                eligibility: "blocked",
                basePriority: 0,
                freshnessPolicyId: "freshness-default",
                applicabilityPolicyId: "applicability-default",
              }),
              eligibility: "blocked",
            },
            mergeFinalizationState: "pending_finalization",
          },
        }),
      });
    } catch (err) {
      if (err instanceof CognitiveMergeCrashError) {
        throw err;
      }
      activated = { ok: false, conflict: "version_conflict" };
    }
    if (!activated.ok) {
      await beginMergeStep("S5c");
      const attached = await catalog.get(params.params.targetResourceId);
      if (
        attached &&
        receipt.attachedTargetVersion !== undefined &&
        attached.envelope.governanceVersion === receipt.attachedTargetVersion
      ) {
        await mergeProtectedCompareAndPut({
          catalog,
          resourceId: attached.envelope.resourceId,
          expectedGovernanceVersion: attached.envelope.governanceVersion,
          fencingToken: reservation.fencingToken,
          conflictGraphEpoch: reservation.reservedGraphEpoch,
          mergeId,
          mutate: (row) => ({
            ...row,
            envelope: { ...row.envelope, activeCognitiveMergeOp: null },
          }),
        });
        await release();
        receipt = await persistReceipt(
          { ...receipt, status: "failed", reasonCode: "S5c" },
          stateDir,
        );
        return { ok: false, error: "derived_create_failed", receipt };
      }
      await release();
      receipt = await persistReceipt({ ...receipt, status: "needs_recovery" }, stateDir);
      return { ok: false, error: "needs_recovery", receipt };
    }

    await endMergeStep("S5");
    await beginMergeStep("S6");
    const commitBase = (await catalog.get(params.params.targetResourceId))!;
    const committed = await mergeProtectedCompareAndPut({
      catalog,
      resourceId: commitBase.envelope.resourceId,
      expectedGovernanceVersion: commitBase.envelope.governanceVersion,
      fencingToken: reservation.fencingToken,
      conflictGraphEpoch: reservation.reservedGraphEpoch,
      mergeId,
      mutate: (row) => ({
        ...row,
        envelope: {
          ...row.envelope,
          activeCognitiveMergeOp: null,
          lastMergeReceiptId: mergeId,
          mergedDerivedMemoryResourceId: reservation.derivedMemoryResourceId,
        },
      }),
    });
    if (!committed.ok) {
      receipt = await persistReceipt({ ...receipt, status: "needs_recovery" }, stateDir);
      return { ok: false, error: "needs_recovery", receipt };
    }
    receipt = await persistReceipt(
      { ...receipt, committedTargetVersion: committed.record.envelope.governanceVersion },
      stateDir,
    );

    await endMergeStep("S6");
    await beginMergeStep("S7");
    receipt = await persistReceipt(
      { ...receipt, status: "applied", appliedAt: new Date().toISOString() },
      stateDir,
    );

    await endMergeStep("S7");
    await beginMergeStep("S8");
    const publishBase = (await catalog.get(reservation.derivedMemoryResourceId))!;
    const published = await mergeProtectedCompareAndPut({
      catalog,
      resourceId: publishBase.envelope.resourceId,
      expectedGovernanceVersion: publishBase.envelope.governanceVersion,
      fencingToken: reservation.fencingToken,
      conflictGraphEpoch: reservation.reservedGraphEpoch,
      mergeId,
      mutate: (row) => ({
        ...row,
        envelope: {
          ...row.envelope,
          retrievalGovernance: {
            ...(row.envelope.retrievalGovernance ?? {
              eligibility: "eligible",
              basePriority: 0.5,
              freshnessPolicyId: "freshness-default",
              applicabilityPolicyId: "applicability-default",
            }),
            eligibility: "eligible",
          },
          mergeFinalizationState: "finalized",
        },
      }),
    });
    if (!published.ok) {
      return { ok: false, error: "needs_recovery", receipt };
    }

    await endMergeStep("S8");
    await beginMergeStep("S9");
    const released = await release();
    if (!released.ok) {
      return { ok: false, error: "needs_recovery", receipt };
    }
    await endMergeStep("S9");
    return { ok: true, receipt, target: committed.record, derived: published.record };
  } catch (err) {
    if (err instanceof CognitiveMergeCrashError) {
      if (err.step !== "S7" && err.step !== "S8" && err.step !== "S6") {
        // Reservation may still be held; takeover is the release path after lease expiry.
      }
      if (receipt.status !== "applied") {
        receipt = await persistReceipt({ ...receipt, status: "needs_recovery" }, stateDir);
      }
      throw err;
    }
    throw err;
  }
}

export type RecoveryReservationReleaseResult =
  | { ok: true }
  | {
      ok: false;
      conflict:
        | "conflict_graph_reserved"
        | "participant_fence_failed"
        | "graph_version_mismatch"
        | "not_fencing";
    };

/**
 * Recovery is a new executor — never a live holder. Same mergeId is not ownership (B40).
 * Live lease → conflict_graph_reserved. Expired / fencing → T1–T4 only.
 */
export async function ensureReservationReleasedForRecovery(params: {
  tenantId: string | null;
  stateDir: string;
  catalog: DataGovernanceCatalogStore;
  originalMergeId: string;
  now?: Date;
  clock?: GovernanceActionClock;
}): Promise<RecoveryReservationReleaseResult> {
  const now = resolveActionClock(params)();
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  const held = head.reservation;
  if (!held) {
    return { ok: true };
  }
  if (held.state !== "fencing" && !isReservationLeaseExpired(held, now)) {
    return { ok: false, conflict: "conflict_graph_reserved" };
  }
  const takeover = await runConflictGraphTakeover({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    catalog: params.catalog,
    now,
  });
  if (takeover.ok || takeover.conflict === "no_reservation") {
    return { ok: true };
  }
  if (takeover.conflict === "lease_live") {
    return { ok: false, conflict: "conflict_graph_reserved" };
  }
  return { ok: false, conflict: takeover.conflict };
}
