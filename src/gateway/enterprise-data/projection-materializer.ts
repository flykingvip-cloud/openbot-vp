import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { recordMaterializedConnectorAction } from "./data-asset-linkage.js";
import { invokeEnterpriseDataAction } from "./data-gateway.js";
import { resolveMaterializerExecutionContextFromBinding } from "./enterprise-data-seat-context.js";
import { findEnterpriseKnowledgeProjectionBinding } from "./enterprise-knowledge-projection-binding-store.js";
import { upsertKnowledgeFeedItem } from "./knowledge-feed-item-store.js";
import { createKnowledgeLineageRecord } from "./knowledge-lineage-store.js";
import {
  decideKnowledgePublication,
  resolveProjectionExecutionIdentity,
  type KnowledgePublicationDecision,
} from "./knowledge-publication.js";
import { projectionSourceId } from "./knowledge-publication.js";
import { recordKnowledgeSupplyAudit } from "./knowledge-supply-audit-store.js";
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
} from "./types.js";
import { applyYonyouTplusSyncCursorToInput } from "./yonyou-tplus-sync.js";

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
}): Promise<Exclude<KnowledgePublicationDecision, { kind: "withhold" }>> {
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
    // AggregateTemplate = list/汇总 knowledge: do not inject incremental sync watermark
    // (NormalizeTemplate "存货增量" still receives the cursor window).
    const input =
      spec.templateKey === "AggregateTemplate"
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

    const published = await invokeSourceAction({
      store: params.store,
      tenantId: params.tenantId,
      spec,
      sourceRef,
      binding,
      input,
      sarProvider: params.sarProvider,
      nowIso: params.nowIso,
    });

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
    const query = input && Object.keys(input).length > 0 ? { ...input } : undefined;

    const feedItem = upsertKnowledgeFeedItem({
      store: params.store,
      tenantId: params.tenantId,
      nowIso: params.nowIso,
      freshnessSlaMinutes: binding.freshnessSlaMinutes,
      item: {
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
