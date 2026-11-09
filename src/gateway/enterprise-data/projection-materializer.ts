import { randomUUID } from "node:crypto";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { readConnectorSyncSnapshotForAction } from "./connector-sync-snapshot.js";
import { recordMaterializedConnectorAction } from "./data-asset-linkage.js";
import { invokeEnterpriseDataAction } from "./data-gateway.js";
import { resolveMaterializerExecutionContextFromBinding } from "./enterprise-data-seat-context.js";
import { findEnterpriseKnowledgeProjectionBinding } from "./enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems, upsertKnowledgeFeedItem } from "./knowledge-feed-item-store.js";
import { createKnowledgeLineageRecord } from "./knowledge-lineage-store.js";
import {
  decideKnowledgePublication,
  projectionSourceId,
  resolveProjectionExecutionIdentity,
} from "./knowledge-publication.js";
import { recordKnowledgeSupplyAudit } from "./knowledge-supply-audit-store.js";
import { applyClassificationMasking } from "./masking-engine.js";
import { findEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { applyProjectionTemplate } from "./projection-template-engine.js";
import { findSarExecutionBridge, type SarGovernanceProvider } from "./sar-governance-bridge.js";
import { formatActionDisplayRef } from "./types.js";
import type {
  EnterpriseKnowledgeObjectFeedItem,
  EnterpriseKnowledgeProjectionBinding,
  EnterpriseKnowledgeProjectionSpec,
  KnowledgeLineageRecord,
  EnterpriseDataStore,
  ProjectionSourceActionRef,
  SarGatewayCorrelation,
} from "./types.js";
import { applyYonyouTplusSyncCursorToInput } from "./yonyou-tplus-sync.js";

type MaterializedPublication = {
  publication: "complete" | "partial";
  data: unknown;
  maskedFields: string[];
  scopeApplied: string;
  traceId: string;
  sar?: SarGatewayCorrelation;
};

/**
 * Aggregate products prefer the sync snapshot so the Feed holds every finished
 * page, not the first live connector page. Masking still uses the action's
 * field classifications. No snapshot falls through to one governed live read.
 */
function publishAggregateFromSyncSnapshot(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  spec: EnterpriseKnowledgeProjectionSpec;
  sourceRef: ProjectionSourceActionRef;
}): MaterializedPublication | null {
  const sourceId = projectionSourceId(params.spec);
  if (!sourceId) {
    return null;
  }
  const snapshot = readConnectorSyncSnapshotForAction({
    store: params.store,
    tenantId: params.tenantId,
    sourceId,
    connectorId: params.sourceRef.connectorId,
    actionKey: params.sourceRef.actionKey,
  });
  if (!snapshot) {
    return null;
  }
  const masking = applyClassificationMasking({
    store: params.store,
    tenantId: params.tenantId,
    ref: params.sourceRef,
    payload: { records: snapshot.rows },
  });
  return {
    publication: snapshot.truncated ? "partial" : "complete",
    data: masking.data,
    maskedFields: masking.maskedFields,
    scopeApplied: "SYNC_SNAPSHOT",
    traceId: `sync-snapshot:${snapshot.snapshotId}:${randomUUID()}`,
  };
}

export type ProjectionMaterializationResult = {
  bindingId: string;
  objectId: string;
  feedItem: EnterpriseKnowledgeObjectFeedItem;
  lineage: KnowledgeLineageRecord;
  gatewayTraceIds: string[];
};

function assertActiveProjection(spec: EnterpriseKnowledgeProjectionSpec): void {
  if (spec.lifecycle !== "active") {
    throw new EnterpriseDataStoreError(
      "PROJECTION_NOT_ACTIVE",
      `Projection ${spec.projectionKey} must be active to materialize (current: ${spec.lifecycle}).`,
    );
  }
}

function assertEnabledBinding(binding: EnterpriseKnowledgeProjectionBinding): void {
  if (!binding.enabled) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_BINDING_DISABLED",
      "Projection binding is disabled.",
    );
  }
}

function assertSingleSourceAction(
  spec: EnterpriseKnowledgeProjectionSpec,
): ProjectionSourceActionRef {
  if (spec.sourceActions.length !== 1) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_SINGLE_SOURCE_REQUIRED",
      "Materializer requires exactly one sourceAction on the projection spec.",
    );
  }
  return spec.sourceActions[0];
}

async function invokeSourceAction(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  spec: EnterpriseKnowledgeProjectionSpec;
  sourceRef: ProjectionSourceActionRef;
  binding: EnterpriseKnowledgeProjectionBinding;
  input?: Record<string, unknown>;
  nowIso: string;
  sarProvider?: SarGovernanceProvider;
}): Promise<MaterializedPublication> {
  const identity = resolveProjectionExecutionIdentity({
    store: params.store,
    tenantId: params.tenantId,
    spec: params.spec,
    sourceRef: params.sourceRef,
  });
  const context = resolveMaterializerExecutionContextFromBinding({
    tenantId: params.tenantId,
    materializationTeamLabel: params.binding.materializationTeamLabel,
  });
  const response = await invokeEnterpriseDataAction({
    store: params.store,
    context: {
      ...context,
      ...(identity.userId
        ? { userId: identity.userId, employeeId: identity.employeeId ?? identity.userId }
        : {}),
    },
    ref: params.sourceRef,
    sourceId: identity.sourceId,
    input: params.input,
    sarProvider: params.sarProvider,
    nowIso: params.nowIso,
  });
  const decision = decideKnowledgePublication({
    response,
    partialPublication: params.spec.partialPublication,
  });
  if (decision.kind === "withhold") {
    throw new EnterpriseDataStoreError(decision.code, decision.message);
  }
  return decision;
}

function recordMaterializationFailure(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  bindingId: string;
  projectionId: string;
  generatorVersion?: string;
  nowIso: string;
  error: unknown;
  sourceTraceIds?: string[];
}): void {
  const errorCode =
    params.error instanceof EnterpriseDataStoreError ? params.error.code : "MATERIALIZATION_FAILED";
  const errorMessage =
    params.error instanceof Error ? params.error.message : "Materialization failed.";
  recordKnowledgeSupplyAudit({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "materialization_failure",
    bindingId: params.bindingId,
    projectionId: params.projectionId,
    nowIso: params.nowIso,
    sourceTraceIds: params.sourceTraceIds,
    status: "failure",
    errorCode,
    errorMessage,
    generatorVersion: params.generatorVersion,
  });
}

export async function runProjectionMaterialization(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  bindingId: string;
  input?: Record<string, unknown>;
  nowIso: string;
  /** In-process SAR provider. Clients cannot supply this. Absent fails closed on website reads. */
  sarProvider?: SarGovernanceProvider;
}): Promise<ProjectionMaterializationResult> {
  let projectionId = "unknown";
  let generatorVersion: string | undefined;
  try {
    const binding = findEnterpriseKnowledgeProjectionBinding(
      params.store,
      params.tenantId,
      params.bindingId,
    );
    if (!binding) {
      throw new EnterpriseDataStoreError(
        "PROJECTION_BINDING_NOT_FOUND",
        "Projection binding not found.",
      );
    }
    projectionId = binding.projectionId;
    generatorVersion = binding.generatorVersion;
    assertEnabledBinding(binding);

    const spec = findEnterpriseKnowledgeProjectionSpec(
      params.store,
      params.tenantId,
      binding.projectionId,
    );
    if (!spec) {
      throw new EnterpriseDataStoreError("PROJECTION_NOT_FOUND", "Projection spec not found.");
    }
    assertActiveProjection(spec);
    const sourceRef = assertSingleSourceAction(spec);
    const cursorNow = Number.isFinite(Date.parse(params.nowIso))
      ? new Date(params.nowIso)
      : new Date();
    // AggregateTemplate = list/汇总 knowledge. A finished sync snapshot is the
    // full/latest pull. Without one, do not inject the incremental watermark
    // (NormalizeTemplate "存货增量" still receives the cursor window).
    const snapshotPublication =
      spec.templateKey === "AggregateTemplate" && !params.input
        ? publishAggregateFromSyncSnapshot({
            store: params.store,
            tenantId: params.tenantId,
            spec,
            sourceRef,
          })
        : null;
    const input = snapshotPublication
      ? undefined
      : spec.templateKey === "AggregateTemplate"
        ? params.input
        : applyYonyouTplusSyncCursorToInput({
            store: params.store,
            tenantId: params.tenantId,
            sourceId: projectionSourceId(spec),
            connectorId: sourceRef.connectorId,
            actionKey: sourceRef.actionKey,
            input: params.input,
            now: cursorNow,
          });

    const published =
      snapshotPublication ??
      (await invokeSourceAction({
        store: params.store,
        tenantId: params.tenantId,
        spec,
        sourceRef,
        binding,
        input,
        sarProvider: params.sarProvider,
        nowIso: params.nowIso,
      }));

    const templateResult = applyProjectionTemplate({
      templateKey: spec.templateKey,
      spec,
      gatewayData: published.data,
      gatewayResponse: published,
    });
    const title =
      published.publication === "partial" && !templateResult.title.includes("不完整")
        ? `${templateResult.title}（不完整）`
        : templateResult.title;
    const query =
      !snapshotPublication && input && Object.keys(input).length > 0 ? { ...input } : undefined;

    // Refresh the current FeedItem in place so a sync does not leave a second,
    // equally timestamped copy that digital humans can still quote.
    const currentFeed = listKnowledgeFeedItems({
      store: params.store,
      tenantId: params.tenantId,
      projectionId: spec.projectionId,
    })[0];
    const feedItem = upsertKnowledgeFeedItem({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      freshnessSlaMinutes: binding.freshnessSlaMinutes,
      item: {
        objectId: currentFeed?.objectId,
        projectionId: spec.projectionId,
        title,
        kind: spec.objectKind,
        category: spec.category,
        sourceSystems: [sourceRef.connectorId],
        scopeApplied: published.scopeApplied,
        maskedFields: published.maskedFields,
        generatedAt: params.nowIso,
        traceRefs: [published.traceId],
        publication: published.publication,
        payload: {
          ...templateResult.payload,
          ...(query ? { query } : {}),
          ...(snapshotPublication
            ? {
                syncSnapshot: {
                  scopeApplied: "SYNC_SNAPSHOT",
                  truncated: snapshotPublication.publication === "partial",
                },
              }
            : {}),
          ...(published.publication === "partial"
            ? { publicationNotice: "不完整输出，不是完整知识对象" }
            : {}),
        },
      },
    });

    const bridge = spec.sourceId
      ? findSarExecutionBridge(params.store, params.tenantId, spec.sourceId, sourceRef)
      : null;
    const sar = published.sar;
    const lineage = createKnowledgeLineageRecord({
      store: params.store,
      tenantId: params.tenantId,
      record: {
        objectId: feedItem.objectId,
        projectionId: spec.projectionId,
        sourceActions: [formatActionDisplayRef(sourceRef)],
        sourceTraceIds: [published.traceId],
        generatedAt: params.nowIso,
        generatorVersion: binding.generatorVersion,
        sourceId: spec.sourceId,
        sarCapabilityId: sar?.capabilityId,
        sarVersion: sar?.version,
        sarRunId: sar?.runId,
        sarEvidenceRef: sar?.evidenceRef,
        validator: bridge?.validator,
        sarVerification: sar?.verification,
        sarCompleteness: sar?.completeness,
        publication: published.publication,
      },
    });

    recordMaterializedConnectorAction({
      store: params.store,
      tenantId: params.tenantId,
      actionRef: sourceRef,
      sourceId: spec.sourceId,
      nowIso: params.nowIso,
    });

    recordKnowledgeSupplyAudit({
      store: params.store,
      tenantId: params.tenantId,
      eventType: "materialization_success",
      bindingId: binding.bindingId,
      projectionId: spec.projectionId,
      objectId: feedItem.objectId,
      lineageId: lineage.lineageId,
      sourceTraceIds: [published.traceId],
      status: "success",
      generatorVersion: binding.generatorVersion,
      nowIso: params.nowIso,
    });

    return {
      bindingId: binding.bindingId,
      objectId: feedItem.objectId,
      feedItem,
      lineage,
      gatewayTraceIds: [published.traceId],
    };
  } catch (error) {
    recordMaterializationFailure({
      store: params.store,
      tenantId: params.tenantId,
      bindingId: params.bindingId,
      projectionId,
      generatorVersion,
      nowIso: params.nowIso,
      error,
    });
    throw error;
  }
}
