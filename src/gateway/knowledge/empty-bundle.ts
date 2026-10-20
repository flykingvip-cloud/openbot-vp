import type { KnowledgeFeedItem } from "./feed/types.js";
import {
  applyDocumentGovernanceOverlay,
  suppressResolvedConflictEdges,
  type DocumentGovernanceOverlay,
} from "./governance/runtime/object-writeback.js";
import { buildRelationshipGraphCached } from "./runtime/relationship-runtime-cache.js";
import { buildPersonalSourceSummary } from "./sources/personal-source.js";
import type { KnowledgeSourceBundle } from "./sources/types.js";
import type {
  DataCapabilityDescriptor,
  ExternalDataSourceSummary,
  KnowledgeObject,
  KnowledgeSourceSummary,
  RelationshipEdge,
  RelationshipGraph,
} from "./types.js";

/**
 * Merge externally-derived edges (e.g. real cross-KB governance relations) into a
 * runtime-built graph: self-loops and edges touching unknown nodes are dropped, and
 * duplicates (by unordered endpoint pair + relation type) are ignored.
 */
function mergeRelationshipEdges(
  nodes: RelationshipGraph["nodes"],
  baseEdges: RelationshipEdge[],
  extraEdges: RelationshipEdge[],
): RelationshipEdge[] {
  if (extraEdges.length === 0) {
    return baseEdges;
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const keyOf = (edge: RelationshipEdge) =>
    `${[edge.sourceId, edge.targetId].toSorted().join("::")}::${edge.relationType}`;
  const seen = new Set(baseEdges.map(keyOf));
  const merged = [...baseEdges];
  for (const edge of extraEdges) {
    if (edge.sourceId === edge.targetId) {
      continue;
    }
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      continue;
    }
    const key = keyOf(edge);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(edge);
  }
  return merged;
}

function buildSourceBrowse(params: {
  objects: KnowledgeObject[];
  enterpriseRestricted: KnowledgeObject[];
}) {
  // Legacy object-source slices for search/recommendations. UI space lists use
  // KnowledgeBase.visibility via knowledge.base.list — do not treat this as the space taxonomy.
  return {
    personal: params.objects.filter((item) => item.source === "personal").slice(0, 12),
    enterprise: params.objects.filter((item) => item.source === "enterprise").slice(0, 12),
    enterpriseRestricted: params.enterpriseRestricted.slice(0, 12),
  };
}

export function buildEmptyKnowledgeSourceSummary(): KnowledgeSourceSummary {
  return {
    personal: { documentCount: 0, recentUpdates: 0 },
    enterprise: { libraryCount: 0, accessibleCount: 0 },
    data: { grantedCount: 0, requestableCount: 0, externalSourceCount: 0 },
  };
}

export function buildKnowledgeSourceBundle(params: {
  objects: KnowledgeObject[];
  dataCapabilities?: DataCapabilityDescriptor[];
  sourceSummary?: KnowledgeSourceSummary;
  enterpriseRestricted?: KnowledgeObject[];
  externalDataSources?: ExternalDataSourceSummary[];
  feedItems?: KnowledgeFeedItem[];
  graph?: RelationshipGraph;
  /** Extra edges (e.g. real cross-KB governance relations) merged into the built graph. */
  extraEdges?: RelationshipEdge[];
  documentGovernanceOverlay?: Map<string, DocumentGovernanceOverlay>;
  /** Chunk citation totals keyed by knowledge-object id (feeds node.governance.usageCount). */
  usageCountByObjectId?: Record<string, number>;
}): KnowledgeSourceBundle {
  const objects = params.objects;
  const dataCapabilities = params.dataCapabilities ?? [];
  const sourceSummary = params.sourceSummary ?? {
    personal: buildPersonalSourceSummary(objects.filter((item) => item.source === "personal")),
    enterprise: { libraryCount: 0, accessibleCount: 0 },
    data: { grantedCount: 0, requestableCount: 0, externalSourceCount: 0 },
  };
  const overlayObjects = params.documentGovernanceOverlay
    ? applyDocumentGovernanceOverlay(objects, params.documentGovernanceOverlay)
    : objects;
  const runtime = buildRelationshipGraphCached({
    objects: overlayObjects,
    dataCapabilities,
    usageCountByObjectId: params.usageCountByObjectId,
  });
  const baseGraph = params.graph ?? {
    nodes: runtime.graph.nodes,
    edges: suppressResolvedConflictEdges(runtime.graph.edges, runtime.objects),
  };
  const graph: RelationshipGraph = params.extraEdges?.length
    ? {
        nodes: baseGraph.nodes,
        edges: mergeRelationshipEdges(baseGraph.nodes, baseGraph.edges, params.extraEdges),
      }
    : baseGraph;
  return {
    objects: runtime.objects,
    dataCapabilities,
    sourceSummary,
    sourceBrowse: buildSourceBrowse({
      objects: runtime.objects,
      enterpriseRestricted: params.enterpriseRestricted ?? [],
    }),
    externalDataSources: params.externalDataSources ?? [],
    feedItems: params.feedItems ?? [],
    graph,
  };
}
