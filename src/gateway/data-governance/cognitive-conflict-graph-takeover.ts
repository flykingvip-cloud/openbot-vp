import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import {
  beginConflictGraphTakeover,
  completeConflictGraphTakeover,
  reservationParticipants,
} from "./cognitive-conflict-graph.js";
import {
  mergeProtectedCompareAndPut,
  type MergeProtectedCasConflict,
} from "./cognitive-merge-fencing.js";
import { getCognitiveMergeReceipt } from "./cognitive-merge-receipt-store.js";
import type { CatalogRecord, CognitiveMergeReceipt, CognitiveMergeReservation } from "./types.js";

export type TakeoverResult =
  | { ok: true; takeoverToken: number; takeoverEpoch: number }
  | {
      ok: false;
      conflict:
        | "no_reservation"
        | "lease_live"
        | "graph_version_mismatch"
        | "not_fencing"
        | "participant_fence_failed";
    };

export type TakeoverFenceFailure = {
  ok: false;
  conflict: "participant_fence_failed";
  resourceId: string;
  reason: MergeProtectedCasConflict | "not_found_churn";
};

export type TakeoverFenceResult = { ok: true } | TakeoverFenceFailure;

export type CognitiveTakeoverFenceInject =
  | "proceed"
  | { conflict: MergeProtectedCasConflict }
  | { vanish: true };

export type CognitiveTakeoverFenceHook = (params: {
  resourceId: string;
  attempt: number;
  current: CatalogRecord | null;
}) => CognitiveTakeoverFenceInject;

let installedFenceHook: CognitiveTakeoverFenceHook | undefined;

/** Test-only. Not re-exported from the production barrel. */
export function installCognitiveTakeoverFenceHookForTests(next?: CognitiveTakeoverFenceHook): void {
  installedFenceHook = next;
}

/**
 * T1–T4: the only path that releases someone else's reservation (B40).
 * T3 must return an explicit fenced success for every participant before T4.
 * Any T3 failure keeps the head `state: "fencing"` and does not clear the reservation.
 */
export async function runConflictGraphTakeover(params: {
  tenantId: string | null;
  stateDir: string;
  catalog: DataGovernanceCatalogStore;
  now?: Date;
}): Promise<TakeoverResult> {
  const begun = await beginConflictGraphTakeover({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    now: params.now,
  });
  if (!begun.ok) {
    return begun;
  }
  const fenced = await fenceParticipants({
    catalog: params.catalog,
    reservation: begun.reservation,
    takeoverToken: begun.takeoverToken,
    takeoverEpoch: begun.takeoverEpoch,
    tenantId: params.tenantId,
    stateDir: params.stateDir,
  });
  if (!fenced.ok) {
    return { ok: false, conflict: "participant_fence_failed" };
  }
  const done = await completeConflictGraphTakeover({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    reservationId: begun.reservation.reservationId,
  });
  if (!done.ok) {
    return { ok: false, conflict: done.conflict };
  }
  return {
    ok: true,
    takeoverToken: begun.takeoverToken,
    takeoverEpoch: begun.takeoverEpoch,
  };
}

export async function fenceParticipants(params: {
  catalog: DataGovernanceCatalogStore;
  reservation: CognitiveMergeReservation;
  takeoverToken: number;
  takeoverEpoch: number;
  tenantId: string | null;
  stateDir: string;
}): Promise<TakeoverFenceResult> {
  const receipt = loadReservationReceipt(params.reservation, params.tenantId, params.stateDir);
  for (const resourceId of reservationParticipants(params.reservation)) {
    const result = await fenceOneParticipant({
      catalog: params.catalog,
      reservation: params.reservation,
      receipt,
      resourceId,
      takeoverToken: params.takeoverToken,
      takeoverEpoch: params.takeoverEpoch,
    });
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}

function originalMergeId(mergeId: string): string {
  return mergeId.startsWith("recover-") ? mergeId.slice("recover-".length) : mergeId;
}

function loadReservationReceipt(
  reservation: CognitiveMergeReservation,
  tenantId: string | null,
  stateDir: string,
): CognitiveMergeReceipt | null {
  return getCognitiveMergeReceipt({
    mergeId: originalMergeId(reservation.mergeId),
    tenantId,
    stateDir,
  });
}

function participantRole(
  reservation: CognitiveMergeReservation,
  resourceId: string,
): "target" | "source" | "derived" {
  if (resourceId === reservation.targetResourceId) {
    return "target";
  }
  if (resourceId === reservation.derivedMemoryResourceId) {
    return "derived";
  }
  return "source";
}

/** Derived may be absent only when persistable evidence proves S3 has not run. */
function maySkipMissingDerived(
  reservation: CognitiveMergeReservation,
  receipt: CognitiveMergeReceipt | null,
): boolean {
  if (reservation.derivedCreated || receipt?.derivedCreated === true) {
    return false;
  }
  const phase = receipt?.protocolPhase;
  if (phase && phase !== "S1" && phase !== "S1b" && phase !== "S2") {
    return false;
  }
  return !reservation.derivedCreated;
}

function alreadyFenced(row: CatalogRecord, takeoverToken: number, takeoverEpoch: number): boolean {
  return (
    (row.envelope.lastAcceptedFencingToken ?? 0) >= takeoverToken &&
    (row.envelope.lastAcceptedConflictGraphEpoch ?? 0) >= takeoverEpoch
  );
}

async function fenceOneParticipant(params: {
  catalog: DataGovernanceCatalogStore;
  reservation: CognitiveMergeReservation;
  receipt: CognitiveMergeReceipt | null;
  resourceId: string;
  takeoverToken: number;
  takeoverEpoch: number;
}): Promise<TakeoverFenceResult> {
  const role = participantRole(params.reservation, params.resourceId);
  const firstRead = await params.catalog.get(params.resourceId);
  const current = firstRead ?? (await params.catalog.get(params.resourceId));
  if (!current) {
    if (role === "derived" && maySkipMissingDerived(params.reservation, params.receipt)) {
      return { ok: true };
    }
    return {
      ok: false,
      conflict: "participant_fence_failed",
      resourceId: params.resourceId,
      reason: "not_found",
    };
  }
  if (alreadyFenced(current, params.takeoverToken, params.takeoverEpoch)) {
    return { ok: true };
  }

  const first = await attemptFence({
    ...params,
    row: current,
    attempt: 1,
  });
  if (first.ok) {
    return first;
  }
  if (first.reason !== "version_conflict") {
    return first;
  }

  const retry = await params.catalog.get(params.resourceId);
  const retryInject = installedFenceHook?.({
    resourceId: params.resourceId,
    attempt: 2,
    current: retry,
  });
  if (!retry || (retryInject && retryInject !== "proceed" && "vanish" in retryInject)) {
    return {
      ok: false,
      conflict: "participant_fence_failed",
      resourceId: params.resourceId,
      reason: "not_found_churn",
    };
  }
  if (alreadyFenced(retry, params.takeoverToken, params.takeoverEpoch)) {
    return { ok: true };
  }
  return attemptFence({
    ...params,
    row: retry,
    attempt: 2,
  });
}

async function attemptFence(params: {
  catalog: DataGovernanceCatalogStore;
  reservation: CognitiveMergeReservation;
  resourceId: string;
  takeoverToken: number;
  takeoverEpoch: number;
  row: CatalogRecord;
  attempt: number;
}): Promise<TakeoverFenceResult> {
  const injected = installedFenceHook?.({
    resourceId: params.resourceId,
    attempt: params.attempt,
    current: params.row,
  });
  if (injected && injected !== "proceed") {
    if ("vanish" in injected) {
      return {
        ok: false,
        conflict: "participant_fence_failed",
        resourceId: params.resourceId,
        reason: "not_found_churn",
      };
    }
    return {
      ok: false,
      conflict: "participant_fence_failed",
      resourceId: params.resourceId,
      reason: injected.conflict,
    };
  }

  const cas = await mergeProtectedCompareAndPut({
    catalog: params.catalog,
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.row.envelope.governanceVersion,
    fencingToken: params.takeoverToken,
    conflictGraphEpoch: params.takeoverEpoch,
    mergeId: params.reservation.mergeId,
    allowForeignAttach: true,
    mutate: (row) => row,
  });
  if (cas.ok) {
    return { ok: true };
  }
  if (cas.conflict === "not_found") {
    return {
      ok: false,
      conflict: "participant_fence_failed",
      resourceId: params.resourceId,
      reason: "not_found_churn",
    };
  }
  return {
    ok: false,
    conflict: "participant_fence_failed",
    resourceId: params.resourceId,
    reason: cas.conflict,
  };
}
