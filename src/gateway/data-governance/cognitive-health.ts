import { resolveStateDir } from "../../config/paths.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import { listConflictEdges } from "./cognitive-conflict-graph.js";
import {
  getCognitiveMergeReceipt,
  listCognitiveMergeReceipts,
} from "./cognitive-merge-receipt-store.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type { CognitiveHealthIndicator, CognitiveHealthReport } from "./types.js";

export type ReportCognitiveHealthParams = {
  tenantId: string | null;
  stateDir?: string;
  catalog?: DataGovernanceCatalogStore;
  now?: Date;
};

/** Read-only. Never remediates, never mutates Catalog or the conflict graph (B44). */
export async function reportCognitiveHealth(
  params: ReportCognitiveHealthParams,
): Promise<CognitiveHealthReport> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const catalog =
    params.catalog ??
    getOrCreateFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
    });
  const memories = await catalog.list("memory");
  const edges = listConflictEdges({ tenantId: params.tenantId, stateDir });
  const receipts = listCognitiveMergeReceipts({ tenantId: params.tenantId, stateDir });
  const indicators: CognitiveHealthIndicator[] = [];

  const retired = memories.filter(
    (row) =>
      row.envelope.lifecycleState === "retired" ||
      row.envelope.retrievalGovernance?.eligibility === "retired",
  );
  indicators.push({
    indicator: "retiredInRecall",
    severity: "p0",
    count: retired.length,
    resourceIds: retired.map((row) => row.envelope.resourceId),
  });

  const blocked = memories.filter(
    (row) => row.envelope.retrievalGovernance?.eligibility === "blocked",
  );
  indicators.push({
    indicator: "blockedInRecall",
    severity: "info",
    count: blocked.length,
    resourceIds: blocked.map((row) => row.envelope.resourceId),
  });

  const dangling = memories.filter(
    (row) =>
      Boolean(row.envelope.cognitiveProvenanceRef) && !row.envelope.cognitiveProvenanceBindingId,
  );
  indicators.push({
    indicator: "danglingProvenanceRef",
    severity: "warn",
    count: dangling.length,
    resourceIds: dangling.map((row) => row.envelope.resourceId),
  });

  const staleAttach = memories.filter((row) => Boolean(row.envelope.activeCognitiveMergeOp));
  indicators.push({
    indicator: "staleMergeAttach",
    severity: "warn",
    count: staleAttach.length,
    resourceIds: staleAttach.map((row) => row.envelope.resourceId),
  });

  const unpublished = memories.filter(
    (row) =>
      row.envelope.mergeFinalizationState === "pending_finalization" &&
      memories.some(
        (other) => other.envelope.mergedDerivedMemoryResourceId === row.envelope.resourceId,
      ),
  );
  indicators.push({
    indicator: "unpublishedMergeProduct",
    severity: "warn",
    count: unpublished.length,
    resourceIds: unpublished.map((row) => row.envelope.resourceId),
  });

  const open = edges.filter((edge) => edge.status === "open");
  indicators.push({
    indicator: "openConflictBacklog",
    severity: open.length > 0 ? "warn" : "info",
    count: open.length,
    resourceIds: open.flatMap((edge) => [edge.leftResourceId, edge.rightResourceId]),
  });

  const postCommit: string[] = [];
  for (const edge of open) {
    for (const resourceId of [edge.leftResourceId, edge.rightResourceId]) {
      const row = memories.find((item) => item.envelope.resourceId === resourceId);
      const receiptId = row?.envelope.lastMergeReceiptId;
      if (!receiptId) {
        continue;
      }
      const receipt =
        receipts.find((item) => item.mergeId === receiptId) ??
        getCognitiveMergeReceipt({ mergeId: receiptId, tenantId: params.tenantId, stateDir });
      if (!receipt?.appliedAt) {
        continue;
      }
      if (Date.parse(receipt.appliedAt) < Date.parse(edge.detectedByAudit.detectedAt)) {
        postCommit.push(edge.edgeId);
        break;
      }
    }
  }
  indicators.push({
    indicator: "postCommitConflict",
    severity: postCommit.length > 0 ? "warn" : "info",
    count: postCommit.length,
    resourceIds: postCommit,
    detail: "open conflict recorded after a committed merge; requires a new authorized resolve",
  });

  return {
    kind: "cognitive_health_report",
    tenantId: params.tenantId,
    generatedAt: (params.now ?? new Date()).toISOString(),
    indicators,
  };
}
