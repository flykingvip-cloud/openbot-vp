import { getAuditTrace } from "./audit-runtime.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { findDataCapability } from "./data-capability-store.js";
import { findDataSource } from "./data-source-store.js";
import { findKnowledgeFeedItem, listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import {
  findKnowledgeLineageRecord,
  listKnowledgeLineageRecords,
} from "./knowledge-lineage-store.js";
import { lineageRecordsVerifiedSar } from "./knowledge-publication.js";
import { findEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import type {
  DataSource,
  EnterpriseDataStore,
  EnterpriseKnowledgeObjectFeedItem,
  EnterpriseKnowledgeProjectionSpec,
  KnowledgeLineageChainNode,
  KnowledgeLineageResolution,
  KnowledgeLineageReverseNode,
  ProjectionSourceActionRef,
} from "./types.js";

function parseActionRefDisplay(ref: string): { actionKey: string; version: string } | null {
  const at = ref.lastIndexOf("@");
  if (at <= 0) {
    return null;
  }
  return {
    actionKey: ref.slice(0, at),
    version: ref.slice(at + 1),
  };
}

function actionIdentity(ref: ProjectionSourceActionRef): string {
  return `${ref.connectorId}::${ref.actionKey}@${ref.version}`;
}

function findMetricPredecessor(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  insightObjectId?: string;
  projection: EnterpriseKnowledgeProjectionSpec;
  feedItem: EnterpriseKnowledgeObjectFeedItem | null;
}): EnterpriseKnowledgeObjectFeedItem | null {
  const explicitId = params.feedItem?.payload.metricObjectId;
  if (typeof explicitId === "string" && explicitId.trim()) {
    const explicit = findKnowledgeFeedItem(params.store, params.tenantId, explicitId);
    if (explicit && explicit.kind === "metric" && explicit.objectId !== params.insightObjectId) {
      return explicit;
    }
  }
  const metrics = listKnowledgeFeedItems({
    store: params.store,
    tenantId: params.tenantId,
  }).filter((item) => item.kind === "metric" && item.objectId !== params.insightObjectId);
  if (params.projection.capabilityId) {
    const sameCapability = metrics.filter((item) => {
      const spec = findEnterpriseKnowledgeProjectionSpec(
        params.store,
        params.tenantId,
        item.projectionId,
      );
      return spec?.capabilityId === params.projection.capabilityId;
    });
    if (sameCapability.length > 0) {
      return sameCapability[0] ?? null;
    }
  }
  const actionKeys = new Set(params.projection.sourceActions.map(actionIdentity));
  return (
    metrics.find((item) => {
      const spec = findEnterpriseKnowledgeProjectionSpec(
        params.store,
        params.tenantId,
        item.projectionId,
      );
      return spec?.sourceActions.some((ref) => actionKeys.has(actionIdentity(ref))) === true;
    }) ?? null
  );
}

function collectSourceData(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projection: EnterpriseKnowledgeProjectionSpec;
}): DataSource[] {
  const seen = new Set<string>();
  const sources: DataSource[] = [];
  const capability = params.projection.capabilityId
    ? findDataCapability(params.store, params.tenantId, params.projection.capabilityId)
    : null;
  for (const sourceId of capability?.sourceIds ?? []) {
    const source = findDataSource(params.store, params.tenantId, sourceId);
    if (!source || seen.has(source.sourceId)) {
      continue;
    }
    seen.add(source.sourceId);
    sources.push(source);
  }
  const connectorIds = new Set(params.projection.sourceActions.map((ref) => ref.connectorId));
  const extras = Object.values(params.store.dataSources)
    .filter((source) => source.tenantId === params.tenantId && connectorIds.has(source.connectorId))
    .toSorted((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  for (const source of extras) {
    if (seen.has(source.sourceId)) {
      continue;
    }
    seen.add(source.sourceId);
    sources.push(source);
  }
  return sources;
}

/** §8.7: Insight → Metric → Projection → ConnectorAction@version → Source Data. */
export function buildKnowledgeLineageReverseChain(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  projection: EnterpriseKnowledgeProjectionSpec;
  feedItem: EnterpriseKnowledgeObjectFeedItem | null;
}): KnowledgeLineageReverseNode[] {
  const nodes: KnowledgeLineageReverseNode[] = [];
  const subjectKind = params.feedItem?.kind ?? params.projection.objectKind;
  if (subjectKind === "insight") {
    nodes.push({
      role: "insight",
      id: params.feedItem?.objectId ?? params.projection.projectionId,
      label: params.feedItem?.title ?? params.projection.displayName,
      refs: { objectKind: "insight", projectionId: params.projection.projectionId },
    });
    const metric = findMetricPredecessor({
      store: params.store,
      tenantId: params.tenantId,
      insightObjectId: params.feedItem?.objectId,
      projection: params.projection,
      feedItem: params.feedItem,
    });
    if (metric) {
      nodes.push({
        role: "metric",
        id: metric.objectId,
        label: metric.title,
        refs: { objectKind: "metric", projectionId: metric.projectionId },
      });
    }
  } else if (subjectKind === "metric") {
    nodes.push({
      role: "metric",
      id: params.feedItem?.objectId ?? params.projection.projectionId,
      label: params.feedItem?.title ?? params.projection.displayName,
      refs: { objectKind: "metric", projectionId: params.projection.projectionId },
    });
  }

  nodes.push({
    role: "projection",
    id: params.projection.projectionId,
    label: params.projection.displayName,
    refs: {
      projectionKey: params.projection.projectionKey,
      objectKind: params.projection.objectKind,
      templateKey: params.projection.templateKey,
    },
  });

  for (const ref of params.projection.sourceActions) {
    nodes.push({
      role: "connector_action",
      id: actionIdentity(ref),
      label: `${ref.actionKey}@${ref.version}`,
      refs: {
        connectorId: ref.connectorId,
        actionKey: ref.actionKey,
        version: ref.version,
      },
    });
  }

  for (const source of collectSourceData(params)) {
    nodes.push({
      role: "source_data",
      id: source.sourceId,
      label: source.displayName,
      refs: {
        sourceKey: source.sourceKey,
        connectorId: source.connectorId,
        status: source.status,
      },
    });
  }
  return nodes;
}

export function resolveKnowledgeLineageChain(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  objectId?: string;
  lineageId?: string;
}): KnowledgeLineageResolution {
  const lineage =
    params.lineageId != null
      ? findKnowledgeLineageRecord(params.store, params.tenantId, params.lineageId)
      : params.objectId != null
        ? (listKnowledgeLineageRecords({
            store: params.store,
            tenantId: params.tenantId,
            objectId: params.objectId,
          })[0] ?? null)
        : null;
  if (!lineage) {
    throw new EnterpriseDataStoreError("LINEAGE_NOT_FOUND", "Knowledge lineage record not found.");
  }

  const feedItem = findKnowledgeFeedItem(params.store, params.tenantId, lineage.objectId);
  const projection = findEnterpriseKnowledgeProjectionSpec(
    params.store,
    params.tenantId,
    lineage.projectionId,
  );
  if (!projection) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_NOT_FOUND",
      "Projection spec not found for lineage.",
    );
  }

  const chain: KnowledgeLineageChainNode[] = [];

  if (feedItem) {
    chain.push({
      layer: "feed_item",
      id: feedItem.objectId,
      label: feedItem.title,
      refs: {
        kind: feedItem.kind,
        category: feedItem.category,
        freshnessStatus: feedItem.freshnessStatus,
        generatedAt: feedItem.generatedAt,
        ...(feedItem.publication ? { publication: feedItem.publication } : {}),
      },
    });
  }

  chain.push({
    layer: "projection",
    id: projection.projectionId,
    label: projection.displayName,
    refs: {
      projectionKey: projection.projectionKey,
      objectKind: projection.objectKind,
      templateKey: projection.templateKey,
      lifecycle: projection.lifecycle,
    },
  });

  if (projection.capabilityId) {
    const capability = findDataCapability(params.store, params.tenantId, projection.capabilityId);
    if (capability) {
      chain.push({
        layer: "capability",
        id: capability.capabilityId,
        label: capability.displayName,
        refs: {
          capabilityKey: capability.capabilityKey,
          enabled: capability.enabled,
        },
      });
      for (const sourceId of capability.sourceIds) {
        const source = findDataSource(params.store, params.tenantId, sourceId);
        if (source) {
          chain.push({
            layer: "data_source",
            id: source.sourceId,
            label: source.displayName,
            refs: {
              sourceKey: source.sourceKey,
              connectorId: source.connectorId,
              status: source.status,
            },
          });
        }
      }
    }
  }

  for (const actionRef of lineage.sourceActions) {
    const parsed = parseActionRefDisplay(actionRef);
    chain.push({
      layer: "connector_action",
      id: actionRef,
      label: actionRef,
      refs: parsed
        ? {
            actionKey: parsed.actionKey,
            version: parsed.version,
          }
        : undefined,
    });
  }

  for (const traceId of lineage.sourceTraceIds) {
    const trace = getAuditTrace({
      store: params.store,
      tenantId: params.tenantId,
      traceId,
    });
    chain.push({
      layer: "invocation_trace",
      id: traceId,
      label: trace.invocation
        ? `${trace.invocation.actionKey}@${trace.invocation.version}`
        : traceId,
      refs: {
        invocationStatus: trace.invocation?.status,
        scopeAppliedLabel: trace.invocation?.scopeAppliedLabel,
        dataAuditMissing: trace.dataAuditMissing,
        ...(lineage.sourceId ? { sourceId: lineage.sourceId } : {}),
        ...(lineage.sarVersion ? { sarVersion: lineage.sarVersion } : {}),
        ...(lineage.sarRunId ? { sarRunId: lineage.sarRunId } : {}),
        ...(lineage.validator ? { validator: lineage.validator } : {}),
        websiteCapabilityVerified: lineageRecordsVerifiedSar(lineage),
      },
    });
  }

  return {
    lineageId: lineage.lineageId,
    objectId: lineage.objectId,
    projectionId: lineage.projectionId,
    chain,
    reverseChain: buildKnowledgeLineageReverseChain({
      store: params.store,
      tenantId: params.tenantId,
      projection,
      feedItem,
    }),
  };
}

export function resolveAuditLineageOverview(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  limit?: number;
}): {
  lineageCount: number;
  supplyAuditCount: number;
  materializationFailureCount: number;
  recentLineage: ReturnType<typeof listKnowledgeLineageRecords>;
  recentReverseChain: KnowledgeLineageReverseNode[];
} {
  const lineage = listKnowledgeLineageRecords({ store: params.store, tenantId: params.tenantId });
  const tenantEvents = Object.values(params.store.knowledgeSupplyAuditEvents).filter(
    (event) => event.tenantId === params.tenantId,
  );
  const supplyAuditCount = tenantEvents.length;
  const materializationFailureCount = tenantEvents.filter(
    (event) => event.status === "failure",
  ).length;
  let recentReverseChain: KnowledgeLineageReverseNode[] = [];
  const latest = lineage[0];
  if (latest) {
    try {
      recentReverseChain = resolveKnowledgeLineageChain({
        store: params.store,
        tenantId: params.tenantId,
        lineageId: latest.lineageId,
      }).reverseChain;
    } catch {
      recentReverseChain = [];
    }
  }
  return {
    lineageCount: lineage.length,
    supplyAuditCount,
    materializationFailureCount,
    recentLineage: lineage.slice(0, params.limit ?? 10),
    recentReverseChain,
  };
}
