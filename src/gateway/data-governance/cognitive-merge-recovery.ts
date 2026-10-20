import { resolveStateDir } from "../../config/paths.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import {
  acquireMergeReservation,
  openConflictEdgesTouching,
  releaseMergeReservation,
  resolveActionClock,
  type GovernanceActionClock,
} from "./cognitive-conflict-graph.js";
import { getCognitiveMergeFaultHook } from "./cognitive-merge-fault-slot.js";
import { mergeProtectedCompareAndPut } from "./cognitive-merge-fencing.js";
import {
  getCognitiveMergeReceipt,
  putCognitiveMergeReceipt,
} from "./cognitive-merge-receipt-store.js";
import { ensureReservationReleasedForRecovery } from "./cognitive-merge.js";
import { appendCognitiveRecoveryAlert } from "./cognitive-recovery-record.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type { CatalogRecord, CognitiveMergeReceipt } from "./types.js";

const DEFAULT_RETRY_BUDGET = 3;

export type RecoverCognitiveMergeParams = {
  mergeId: string;
  tenantId: string | null;
  retryBudget?: number;
  now?: Date;
  clock?: GovernanceActionClock;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
};

export type RecoverCognitiveMergeResult =
  | { ok: true; receipt: CognitiveMergeReceipt; classification: "post_commit" | "pre_commit" }
  | { ok: false; error: string; receipt?: CognitiveMergeReceipt };

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

export function hasCommitEvidence(params: {
  receipt: CognitiveMergeReceipt;
  target: CatalogRecord | null;
}): boolean {
  if (params.receipt.status === "applied") {
    return true;
  }
  const target = params.target?.envelope;
  return Boolean(
    target?.lastMergeReceiptId === params.receipt.mergeId &&
    target.mergedDerivedMemoryResourceId === params.receipt.derivedMemoryResourceId,
  );
}

export function classifyMergeTerminalRefs(params: {
  lastMergeReceiptId?: string | null;
  mergedDerivedMemoryResourceId?: string | null;
  mergeId: string;
  derivedId: string;
}): "empty" | "match" | "conflict" {
  const last = params.lastMergeReceiptId ?? null;
  const merged = params.mergedDerivedMemoryResourceId ?? null;
  if (last === null && merged === null) {
    return "empty";
  }
  if (last === params.mergeId && merged === params.derivedId) {
    return "match";
  }
  return "conflict";
}

async function persist(
  receipt: CognitiveMergeReceipt,
  stateDir: string,
): Promise<CognitiveMergeReceipt> {
  return putCognitiveMergeReceipt({ receipt, stateDir });
}

export async function recoverCognitiveMerge(
  params: RecoverCognitiveMergeParams,
): Promise<RecoverCognitiveMergeResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const catalog = catalogFor(params);
  const budget = params.retryBudget ?? DEFAULT_RETRY_BUDGET;
  const clock = resolveActionClock(params);
  const receipt = getCognitiveMergeReceipt({
    mergeId: params.mergeId,
    tenantId: params.tenantId,
    stateDir,
  });
  if (!receipt) {
    return { ok: false, error: "not_found" };
  }
  if (receipt.status === "applied") {
    const target = await catalog.get(receipt.targetResourceId);
    if (hasCommitEvidence({ receipt, target })) {
      return finalizePostCommit({
        receipt,
        catalog,
        stateDir,
        tenantId: params.tenantId,
        now: params.now,
        clock,
      });
    }
  }
  if (
    receipt.status === "failed" ||
    receipt.status === "conflicted" ||
    receipt.status === "rejected"
  ) {
    return { ok: false, error: receipt.status, receipt };
  }

  for (let attempt = 0; attempt < budget; attempt += 1) {
    const target = await catalog.get(receipt.targetResourceId);
    const latest = getCognitiveMergeReceipt({
      mergeId: params.mergeId,
      tenantId: params.tenantId,
      stateDir,
    })!;
    if (hasCommitEvidence({ receipt: latest, target })) {
      return finalizePostCommit({
        receipt: latest,
        catalog,
        stateDir,
        tenantId: params.tenantId,
        now: params.now,
        clock,
      });
    }
    const pre = await recoverPreCommit({
      receipt: latest,
      target,
      catalog,
      stateDir,
      tenantId: params.tenantId,
      now: params.now,
      clock,
    });
    if (pre.done) {
      return pre.result;
    }
  }
  const stuck = await persist(
    {
      ...(getCognitiveMergeReceipt({
        mergeId: params.mergeId,
        tenantId: params.tenantId,
        stateDir,
      }) ?? receipt),
      status: "needs_recovery",
      recoveryAttempts: budget,
    },
    stateDir,
  );
  appendCognitiveRecoveryAlert({
    mergeId: params.mergeId,
    tenantId: params.tenantId,
    stateDir,
    reason: "retry_budget_exhausted",
  });
  return { ok: false, error: "needs_recovery", receipt: stuck };
}

async function finalizePostCommit(params: {
  receipt: CognitiveMergeReceipt;
  catalog: DataGovernanceCatalogStore;
  stateDir: string;
  tenantId: string | null;
  now?: Date;
  clock: GovernanceActionClock;
}): Promise<RecoverCognitiveMergeResult> {
  if (getCognitiveMergeFaultHook()?.forceAbandonPostCommit) {
    throw new Error("cognitive_merge_fault:post_commit_abandon_forbidden");
  }
  const released = await ensureReservationReleasedForRecovery({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    catalog: params.catalog,
    originalMergeId: params.receipt.mergeId,
    now: params.now,
    clock: params.clock,
  });
  if (!released.ok) {
    return { ok: false, error: released.conflict, receipt: params.receipt };
  }
  const derivedId = params.receipt.derivedMemoryResourceId;
  if (!derivedId) {
    return { ok: false, error: "invalid_merge_request", receipt: params.receipt };
  }
  const acquired = await acquireMergeReservation({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    mergeId: `recover-${params.receipt.mergeId}`,
    targetResourceId: params.receipt.targetResourceId,
    sourceResourceIds: params.receipt.sourceResourceIds,
    derivedMemoryResourceId: derivedId,
    now: params.now,
    derivedCreated: params.receipt.derivedCreated === true,
  });
  if (!acquired.ok) {
    return { ok: false, error: acquired.conflict, receipt: params.receipt };
  }
  const reservation = acquired.reservation;
  const holder = acquired.holder;
  const releaseOwn = async () => {
    if (getCognitiveMergeFaultHook()?.failRecoveryRelease) {
      return { ok: false as const, conflict: "lease_expired" as const };
    }
    return releaseMergeReservation({
      tenantId: params.tenantId,
      stateDir: params.stateDir,
      holder,
      clock: params.clock,
    });
  };
  const target = await params.catalog.get(params.receipt.targetResourceId);
  if (!target) {
    await releaseOwn();
    return { ok: false, error: "not_found", receipt: params.receipt };
  }
  const refs = classifyMergeTerminalRefs({
    lastMergeReceiptId: target.envelope.lastMergeReceiptId,
    mergedDerivedMemoryResourceId: target.envelope.mergedDerivedMemoryResourceId,
    mergeId: params.receipt.mergeId,
    derivedId,
  });
  if (refs === "conflict") {
    await releaseOwn();
    return { ok: false, error: "terminal_ref_conflict", receipt: params.receipt };
  }
  const targetCas = getCognitiveMergeFaultHook()?.failPostCommitTargetCas
    ? ({ ok: false, conflict: "version_conflict" } as const)
    : await mergeProtectedCompareAndPut({
        catalog: params.catalog,
        resourceId: target.envelope.resourceId,
        expectedGovernanceVersion: target.envelope.governanceVersion,
        fencingToken: reservation.fencingToken,
        conflictGraphEpoch: reservation.reservedGraphEpoch,
        mergeId: params.receipt.mergeId,
        mutate: (row) => {
          const live = classifyMergeTerminalRefs({
            lastMergeReceiptId: row.envelope.lastMergeReceiptId,
            mergedDerivedMemoryResourceId: row.envelope.mergedDerivedMemoryResourceId,
            mergeId: params.receipt.mergeId,
            derivedId,
          });
          if (live === "conflict") {
            return null;
          }
          return {
            ...row,
            envelope: {
              ...row.envelope,
              activeCognitiveMergeOp: null,
              ...(live === "empty"
                ? {
                    lastMergeReceiptId: params.receipt.mergeId,
                    mergedDerivedMemoryResourceId: derivedId,
                  }
                : {}),
            },
          };
        },
      });
  if (!targetCas.ok) {
    await releaseOwn();
    return { ok: false, error: targetCas.conflict, receipt: params.receipt };
  }
  let receipt = params.receipt;
  if (receipt.status !== "applied") {
    receipt = await persist(
      { ...receipt, status: "applied", appliedAt: receipt.appliedAt ?? new Date().toISOString() },
      params.stateDir,
    );
  }
  const derived = await params.catalog.get(derivedId);
  if (!derived) {
    await releaseOwn();
    return { ok: false, error: "needs_recovery", receipt };
  }
  if (derived.envelope.mergeFinalizationState !== "finalized") {
    const published = await mergeProtectedCompareAndPut({
      catalog: params.catalog,
      resourceId: derived.envelope.resourceId,
      expectedGovernanceVersion: derived.envelope.governanceVersion,
      fencingToken: reservation.fencingToken,
      conflictGraphEpoch: reservation.reservedGraphEpoch,
      mergeId: params.receipt.mergeId,
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
      await releaseOwn();
      return { ok: false, error: published.conflict, receipt };
    }
  }
  const ownReleased = await releaseOwn();
  if (!ownReleased.ok) {
    return { ok: false, error: "needs_recovery", receipt };
  }
  return { ok: true, receipt, classification: "post_commit" };
}

async function recoverPreCommit(params: {
  receipt: CognitiveMergeReceipt;
  target: CatalogRecord | null;
  catalog: DataGovernanceCatalogStore;
  stateDir: string;
  tenantId: string | null;
  now?: Date;
  clock: GovernanceActionClock;
}): Promise<{ done: true; result: RecoverCognitiveMergeResult } | { done: false }> {
  const op = params.target?.envelope.activeCognitiveMergeOp;
  if (!op || op.mergeId !== params.receipt.mergeId) {
    const failed = await persist(
      { ...params.receipt, status: "failed", reasonCode: "foreign_marker" },
      params.stateDir,
    );
    return { done: true, result: { ok: false, error: "failed", receipt: failed } };
  }
  const released = await ensureReservationReleasedForRecovery({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    catalog: params.catalog,
    originalMergeId: params.receipt.mergeId,
    now: params.now,
    clock: params.clock,
  });
  if (!released.ok) {
    const parked = await persist(
      {
        ...params.receipt,
        status: "needs_recovery",
        reasonCode: released.conflict,
      },
      params.stateDir,
    );
    return { done: true, result: { ok: false, error: released.conflict, receipt: parked } };
  }
  const derivedId = params.receipt.derivedMemoryResourceId ?? op.derivedMemoryResourceId;
  const acquired = await acquireMergeReservation({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    mergeId: `recover-${params.receipt.mergeId}`,
    targetResourceId: params.receipt.targetResourceId,
    sourceResourceIds: params.receipt.sourceResourceIds,
    derivedMemoryResourceId: derivedId,
    now: params.now,
    derivedCreated: params.receipt.derivedCreated === true,
  });
  if (!acquired.ok) {
    return { done: false };
  }
  const reservation = acquired.reservation;
  const holder = acquired.holder;
  const releaseOwn = async () => {
    if (getCognitiveMergeFaultHook()?.failRecoveryRelease) {
      return { ok: false as const, conflict: "lease_expired" as const };
    }
    return releaseMergeReservation({
      tenantId: params.tenantId,
      stateDir: params.stateDir,
      holder,
      clock: params.clock,
    });
  };
  const hook = getCognitiveMergeFaultHook();
  const target = (await params.catalog.get(params.receipt.targetResourceId))!;
  const claim =
    hook?.failRecoveryProtectedCas === "claim"
      ? ({ ok: false, conflict: "version_conflict" } as const)
      : await mergeProtectedCompareAndPut({
          catalog: params.catalog,
          resourceId: target.envelope.resourceId,
          expectedGovernanceVersion: target.envelope.governanceVersion,
          fencingToken: reservation.fencingToken,
          conflictGraphEpoch: reservation.reservedGraphEpoch,
          mergeId: params.receipt.mergeId,
          mutate: (row) => row,
        });
  if (!claim.ok) {
    await releaseOwn();
    return { done: false };
  }
  const blocking = openConflictEdgesTouching({
    resourceIds: [params.receipt.targetResourceId, ...params.receipt.sourceResourceIds],
    tenantId: params.tenantId,
    stateDir: params.stateDir,
  });
  const derived = await params.catalog.get(derivedId);
  const abandon = blocking.length > 0 || !derived;
  if (abandon) {
    const abandonedTarget =
      hook?.failRecoveryProtectedCas === "abandon"
        ? ({ ok: false, conflict: "version_conflict" } as const)
        : await mergeProtectedCompareAndPut({
            catalog: params.catalog,
            resourceId: target.envelope.resourceId,
            expectedGovernanceVersion: (await params.catalog.get(params.receipt.targetResourceId))!
              .envelope.governanceVersion,
            fencingToken: reservation.fencingToken,
            conflictGraphEpoch: reservation.reservedGraphEpoch,
            mergeId: params.receipt.mergeId,
            mutate: (row) => ({
              ...row,
              envelope: { ...row.envelope, activeCognitiveMergeOp: null },
            }),
          });
    if (!abandonedTarget.ok) {
      await releaseOwn();
      return { done: false };
    }
    if (derived) {
      const abandonedDerived = await mergeProtectedCompareAndPut({
        catalog: params.catalog,
        resourceId: derived.envelope.resourceId,
        expectedGovernanceVersion: derived.envelope.governanceVersion,
        fencingToken: reservation.fencingToken,
        conflictGraphEpoch: reservation.reservedGraphEpoch,
        mergeId: params.receipt.mergeId,
        mutate: (row) => ({
          ...row,
          envelope: {
            ...row.envelope,
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
      if (!abandonedDerived.ok) {
        await releaseOwn();
        return { done: false };
      }
    }
    await releaseOwn();
    const failed = await persist(
      { ...params.receipt, status: "failed", reasonCode: "abandon" },
      params.stateDir,
    );
    return { done: true, result: { ok: false, error: "failed", receipt: failed } };
  }
  const live = (await params.catalog.get(params.receipt.targetResourceId))!;
  const committed = await mergeProtectedCompareAndPut({
    catalog: params.catalog,
    resourceId: live.envelope.resourceId,
    expectedGovernanceVersion: live.envelope.governanceVersion,
    fencingToken: reservation.fencingToken,
    conflictGraphEpoch: reservation.reservedGraphEpoch,
    mergeId: params.receipt.mergeId,
    mutate: (row) => ({
      ...row,
      envelope: {
        ...row.envelope,
        activeCognitiveMergeOp: null,
        lastMergeReceiptId: params.receipt.mergeId,
        mergedDerivedMemoryResourceId: derivedId,
      },
    }),
  });
  if (!committed.ok) {
    await releaseOwn();
    return { done: false };
  }
  const applied = await persist(
    { ...params.receipt, status: "applied", appliedAt: new Date().toISOString() },
    params.stateDir,
  );
  const derivedLive = await params.catalog.get(derivedId);
  if (!derivedLive) {
    await releaseOwn();
    return { done: true, result: { ok: false, error: "needs_recovery", receipt: applied } };
  }
  const published =
    hook?.failRecoveryProtectedCas === "publish"
      ? ({ ok: false, conflict: "version_conflict" } as const)
      : await mergeProtectedCompareAndPut({
          catalog: params.catalog,
          resourceId: derivedLive.envelope.resourceId,
          expectedGovernanceVersion: derivedLive.envelope.governanceVersion,
          fencingToken: reservation.fencingToken,
          conflictGraphEpoch: reservation.reservedGraphEpoch,
          mergeId: params.receipt.mergeId,
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
    await releaseOwn();
    return { done: true, result: { ok: false, error: "needs_recovery", receipt: applied } };
  }
  const ownReleased = await releaseOwn();
  if (!ownReleased.ok) {
    return { done: true, result: { ok: false, error: "needs_recovery", receipt: applied } };
  }
  return { done: true, result: { ok: true, receipt: applied, classification: "pre_commit" } };
}
