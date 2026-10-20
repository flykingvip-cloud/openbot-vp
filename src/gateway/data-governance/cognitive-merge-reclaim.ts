import { resolveStateDir } from "../../config/paths.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import { isReservationLeaseExpired, readConflictGraphHead } from "./cognitive-conflict-graph.js";
import { mergeProtectedCompareAndPut } from "./cognitive-merge-fencing.js";
import {
  isTerminalMergeReceiptStatus,
  listCognitiveMergeReceipts,
  putCognitiveMergeReceipt,
} from "./cognitive-merge-receipt-store.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type { CognitiveMergeReceipt } from "./types.js";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type ReclaimMergeOrphansParams = {
  tenantId: string | null;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
  now?: Date;
  ttlMs?: number;
};

export type ReclaimMergeOrphansResult = {
  reclaimed: string[];
  skipped: string[];
};

/**
 * Merge-class reclamation (B37). A committed-but-unpublished product is never
 * reclaimed: the target names it (condition 4).
 */
export async function reclaimMergeOrphans(
  params: ReclaimMergeOrphansParams,
): Promise<ReclaimMergeOrphansResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const catalog =
    params.catalog ??
    getOrCreateFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
    });
  const now = params.now ?? new Date();
  const ttlMs = params.ttlMs ?? DEFAULT_TTL_MS;
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir });
  const receipts = listCognitiveMergeReceipts({ tenantId: params.tenantId, stateDir });
  const reclaimed: string[] = [];
  const skipped: string[] = [];

  for (const receipt of receipts) {
    if (receipt.status === "needs_recovery") {
      skipped.push(receipt.mergeId);
      continue;
    }
    const derivedId = receipt.derivedMemoryResourceId;
    if (!derivedId) {
      continue;
    }
    const derived = await catalog.get(derivedId);
    if (!derived) {
      continue;
    }
    const leaseLive =
      head.reservation &&
      head.reservation.mergeId === receipt.mergeId &&
      !isReservationLeaseExpired(head.reservation, now);
    if (leaseLive) {
      skipped.push(receipt.mergeId);
      continue;
    }
    if (head.reservation?.state === "fencing") {
      skipped.push(receipt.mergeId);
      continue;
    }
    const tokenMatch =
      (derived.envelope.lastAcceptedFencingToken ?? 0) === (receipt.fencingToken ?? 0);
    if (!tokenMatch) {
      skipped.push(receipt.mergeId);
      continue;
    }
    const referenced = (await catalog.list("memory")).some(
      (row) => row.envelope.mergedDerivedMemoryResourceId === derivedId,
    );
    if (referenced) {
      skipped.push(receipt.mergeId);
      continue;
    }
    const aged = Date.parse(derived.envelope.createdAt) + ttlMs <= now.getTime();
    const terminal = isTerminalMergeReceiptStatus(receipt.status);
    const leaseExpired =
      !head.reservation ||
      (head.reservation.mergeId === receipt.mergeId &&
        isReservationLeaseExpired(head.reservation, now));
    if (!aged || !(terminal || leaseExpired)) {
      skipped.push(receipt.mergeId);
      continue;
    }
    await mergeProtectedCompareAndPut({
      catalog,
      resourceId: derivedId,
      expectedGovernanceVersion: derived.envelope.governanceVersion,
      fencingToken: derived.envelope.lastAcceptedFencingToken ?? 0,
      conflictGraphEpoch: derived.envelope.lastAcceptedConflictGraphEpoch ?? 0,
      mergeId: receipt.mergeId,
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
    if (receipt.status !== "failed" && receipt.status !== "applied") {
      await putCognitiveMergeReceipt({
        receipt: {
          ...receipt,
          status: "failed",
          reasonCode: "reclaimed",
        } satisfies CognitiveMergeReceipt,
        stateDir,
      });
    }
    reclaimed.push(derivedId);
  }
  return { reclaimed, skipped };
}
