import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import {
  runPrivilegedCognitiveCatalogCas,
  runPrivilegedCognitiveCatalogCreate,
} from "./cognitive-cas-internal.js";
import type { CatalogRecord, DataGovernanceEnvelope } from "./types.js";

export type MergeProtectedCasConflict =
  | "not_found"
  | "version_conflict"
  | "resource_id_mismatch"
  | "fenced_stale_token"
  | "fenced_stale_graph_epoch"
  | "merge_in_flight"
  | "already_exists";

export type MergeProtectedCasResult =
  | { ok: true; record: CatalogRecord }
  | { ok: false; conflict: MergeProtectedCasConflict };

/**
 * Merge-protected Catalog write (B34/B39). Token and graph epoch are verified inside
 * the CAS predicate; the same write advances both generations.
 */
export async function mergeProtectedCompareAndPut(params: {
  catalog: DataGovernanceCatalogStore;
  resourceId: string;
  expectedGovernanceVersion: number;
  fencingToken: number;
  conflictGraphEpoch: number;
  mergeId: string;
  allowForeignAttach?: boolean;
  mutate: (current: CatalogRecord) => CatalogRecord | null;
}): Promise<MergeProtectedCasResult> {
  const current = await params.catalog.get(params.resourceId);
  if (!current) {
    return { ok: false, conflict: "not_found" };
  }
  if (current.envelope.governanceVersion !== params.expectedGovernanceVersion) {
    return { ok: false, conflict: "version_conflict" };
  }
  const drafted = params.mutate(current);
  if (!drafted) {
    return { ok: false, conflict: "version_conflict" };
  }
  const now = new Date().toISOString();
  const next: CatalogRecord = {
    ...drafted,
    envelope: {
      ...drafted.envelope,
      schemaVersion: 2,
      governanceVersion: params.expectedGovernanceVersion + 1,
      updatedAt: now,
      lastAcceptedFencingToken: params.fencingToken,
      lastAcceptedConflictGraphEpoch: params.conflictGraphEpoch,
    },
  };
  const cas = await runPrivilegedCognitiveCatalogCas(params.catalog, {
    resourceId: params.resourceId,
    expectedGovernanceVersion: params.expectedGovernanceVersion,
    expectedMergeFencing: {
      fencingToken: params.fencingToken,
      conflictGraphEpoch: params.conflictGraphEpoch,
      mergeId: params.mergeId,
      ...(params.allowForeignAttach ? { allowForeignAttach: true } : {}),
    },
    next,
  });
  if (!cas.ok) {
    return { ok: false, conflict: cas.conflict };
  }
  return cas;
}

export async function uniqueCreateDerivedMemory(params: {
  catalog: DataGovernanceCatalogStore;
  record: CatalogRecord;
}): Promise<MergeProtectedCasResult> {
  const cas = await runPrivilegedCognitiveCatalogCreate(params.catalog, params.record);
  if (!cas.ok) {
    return { ok: false, conflict: cas.conflict };
  }
  return cas;
}

export function stampFencing(
  envelope: DataGovernanceEnvelope,
  fencingToken: number,
  conflictGraphEpoch: number,
): DataGovernanceEnvelope {
  return {
    ...envelope,
    lastAcceptedFencingToken: fencingToken,
    lastAcceptedConflictGraphEpoch: conflictGraphEpoch,
  };
}
