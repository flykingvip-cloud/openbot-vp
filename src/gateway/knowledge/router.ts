import type { KnowledgeEvidence } from "../../retrieval/types.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { loadEnterpriseDataStore } from "../enterprise-data/store.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import { buildKnowledgeActionSuggestions } from "./actions/action-engine.js";
import type { KnowledgeActionSuggestion } from "./actions/types.js";
import { resolveKnowledgeSourceContext } from "./context.js";
import { listKnowledgeDiscoveryEvents } from "./discovery/event-projector.js";
import type { KnowledgeDiscoveryEvent } from "./discovery/types.js";
import {
  knowledgeObjectMatchesQuery,
  preferEnterpriseFeedMatches,
} from "./enterprise-data-query.js";
import { canAccessEnterpriseFeedProjection } from "./feed/enterprise-feed-adapter.js";
import { summarizeKnowledgeFeed } from "./feed/knowledge-feed-adapter.js";
import type { KnowledgeFeedItem as FeedItem } from "./feed/types.js";
import { filterRelationshipGraph } from "./graph-builder.js";
import { authorizeKnowledgeBaseAccess, clientKnowledgeEmail } from "./knowledge-access-gate.js";
import {
  anyAccessibleKnowledgeBaseHasIndexedChunks,
  retrievalContextFromKnowledgeSourceContext,
  searchKnowledgeEvidence,
  type KnowledgeSearchMode,
} from "./knowledge-retrieval-runtime.js";
import { explainKnowledgeLineage } from "./lineage/lineage-explain.js";
import { listKnowledgeRecentVisits, recordKnowledgeRecentVisit } from "./recent-visits.js";
import { capRelationshipGraph } from "./relationship-graph-limits.js";
import { classifyKnowledgeIntent } from "./resolve/intent-classifier.js";
import {
  buildKnowledgeAgentProfile,
  runKnowledgeContextEngine,
  runKnowledgeResolveEngine,
  runKnowledgeRuntimeEngine,
} from "./resolve/resolve-engine.js";
import { selectKnowledgeSources } from "./resolve/source-selector.js";
import { filterObjectsForAgentConsumption } from "./runtime/agent-cognitive-adapter.js";
import { buildKnowledgeRelatedGroups } from "./runtime/related-groups.js";
import { buildRelationshipRecommendations } from "./runtime/relationship-recommendation.js";
import { loadKnowledgeSourceBundle } from "./source-bundle.js";
import type { KnowledgeSourceBundle } from "./sources/types.js";
import type {
  DataCapabilityDescriptor,
  ExternalDataSourceSummary,
  KnowledgeAgentContext,
  KnowledgeAgentProfile,
  KnowledgeCognitiveBundle,
  KnowledgeLineageExplain,
  KnowledgeObject,
  KnowledgeRecentVisit,
  KnowledgeRecommendation,
  KnowledgeRelatedGroups,
  KnowledgeSourceBrowse,
  KnowledgeSourceSummary,
  KnowledgeTaskContext,
  RelationshipGraph,
} from "./types.js";

function normalizeQuery(query: string | undefined): string {
  return (query ?? "").trim().toLowerCase();
}

function matchesQuery(object: KnowledgeObject, query: string): boolean {
  return knowledgeObjectMatchesQuery(object, query);
}

function objectIndex(bundle: KnowledgeSourceBundle): Map<string, KnowledgeObject> {
  return new Map(bundle.objects.map((item) => [item.id, item]));
}

function graphNodeIndex(graph: RelationshipGraph): Map<string, RelationshipGraph["nodes"][number]> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

export async function loadKnowledgeBundle(
  client: GatewayClient | null,
): Promise<KnowledgeSourceBundle> {
  return loadKnowledgeSourceBundle(client);
}

export function knowledgeSearchFromBundle(
  bundle: KnowledgeSourceBundle,
  params: { query?: string; limit?: number },
): {
  results: KnowledgeObject[];
  evidence: KnowledgeEvidence[];
  searchMode: KnowledgeSearchMode;
  sourceSummary: KnowledgeSourceSummary;
  dataCapabilities: DataCapabilityDescriptor[];
  sourceBrowse: KnowledgeSourceBrowse;
  externalDataSources: ExternalDataSourceSummary[];
} {
  const query = normalizeQuery(params.query);
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50);
  const results = preferEnterpriseFeedMatches(
    bundle.objects.filter((item) => matchesQuery(item, query)),
    query,
  ).slice(0, limit);
  return {
    results,
    evidence: [],
    searchMode: "substring",
    sourceSummary: bundle.sourceSummary,
    dataCapabilities: bundle.dataCapabilities,
    sourceBrowse: bundle.sourceBrowse,
    externalDataSources: bundle.externalDataSources,
  };
}

export async function knowledgeSearch(
  client: GatewayClient | null,
  params: { query?: string; limit?: number },
) {
  const query = normalizeQuery(params.query);
  // Shared principal-scoped bundle (in-flight merge + short TTL). Results are
  // already truncated to `limit` (1–50, default 20).
  const bundle = await loadKnowledgeBundle(client);
  if (!query) {
    return knowledgeSearchFromBundle(bundle, params);
  }

  const context = await resolveKnowledgeSourceContext(client);
  const retrievalContext = retrievalContextFromKnowledgeSourceContext(context);
  const hasIndexedChunks = await anyAccessibleKnowledgeBaseHasIndexedChunks({ retrievalContext });
  const substring = knowledgeSearchFromBundle(bundle, params);
  if (hasIndexedChunks) {
    const evidence = await searchKnowledgeEvidence({
      query,
      retrievalContext,
      maxResults: Math.min(Math.max(params.limit ?? 20, 1), 50),
    });
    if (evidence.length > 0) {
      // Indexed library hits must not hide materialized enterprise feed objects
      // (用友 T+ 仓库 / 存货). Those rows live on the feed, not in KB chunks.
      return {
        results: substring.results.filter((item) => item.source === "enterprise"),
        evidence,
        searchMode: "indexed" as const,
        sourceSummary: bundle.sourceSummary,
        dataCapabilities: bundle.dataCapabilities,
        sourceBrowse: bundle.sourceBrowse,
        externalDataSources: bundle.externalDataSources,
      };
    }
  }

  return substring;
}

export function knowledgeRelationshipsFromBundle(
  bundle: KnowledgeSourceBundle,
  params: { query?: string; focusNodeId?: string | null },
): RelationshipGraph {
  return filterRelationshipGraph({
    graph: bundle.graph,
    query: params.query,
    focusNodeId: params.focusNodeId ?? null,
  });
}

export async function knowledgeRelationships(
  client: GatewayClient | null,
  params: {
    query?: string;
    focusNodeId?: string | null;
    focusDocumentId?: string | null;
    knowledgeBaseId?: string | null;
  },
): Promise<RelationshipGraph> {
  const focusDocumentId = params.focusDocumentId?.trim() || null;
  let knowledgeBaseId = params.knowledgeBaseId?.trim() || null;
  const context = await resolveKnowledgeSourceContext(client);
  const email = clientKnowledgeEmail(client);
  const canReadKb = (id: string) =>
    Boolean(
      authorizeKnowledgeBaseAccess({
        knowledgeBaseId: id,
        context,
        email,
        permission: "read",
      }),
    );
  const bundle = await loadKnowledgeBundle(client);
  const kbGraph = knowledgeRelationshipsFromBundle(bundle, {
    query: params.query,
    focusNodeId: focusDocumentId ? null : (params.focusNodeId ?? null),
  });
  // Folder / space select: library document panorama for that KB (enterprise
  // shared readable spaces included — index opens via the KB owner path).
  if (!focusDocumentId && knowledgeBaseId) {
    if (!canReadKb(knowledgeBaseId)) {
      return capRelationshipGraph(kbGraph, "summary");
    }
    const { buildKnowledgeBaseLibraryGraphForKnowledgeBase } =
      await import("./document-ego-graph-runtime.js");
    const library = await buildKnowledgeBaseLibraryGraphForKnowledgeBase({
      knowledgeBaseId,
    });
    if (library) {
      return capRelationshipGraph(
        filterRelationshipGraph({
          graph: library,
          query: params.query,
          focusNodeId: null,
        }),
        "library",
      );
    }
    return capRelationshipGraph(kbGraph, "summary");
  }
  if (!focusDocumentId) {
    // Unfocused home: return a capped hub/space summary, not the full index panorama.
    return capRelationshipGraph(kbGraph, "summary");
  }
  if (!knowledgeBaseId) {
    const { listKnowledgeBases } = await import("./knowledge-base-store.js");
    for (const base of listKnowledgeBases()) {
      if (!canReadKb(base.id)) {
        continue;
      }
      if (
        base.documentIds.includes(focusDocumentId) ||
        (base.recycledDocumentIds ?? []).includes(focusDocumentId)
      ) {
        knowledgeBaseId = base.id;
        break;
      }
    }
  }
  if (!knowledgeBaseId) {
    return capRelationshipGraph(kbGraph, "summary");
  }
  if (!canReadKb(knowledgeBaseId)) {
    return capRelationshipGraph(kbGraph, "summary");
  }
  const { buildDocumentEgoGraphForKnowledgeBase } = await import("./document-ego-graph-runtime.js");
  const ego = await buildDocumentEgoGraphForKnowledgeBase({
    knowledgeBaseId,
    docId: focusDocumentId,
  });
  if (!ego) {
    // Still do not invent a library panorama under a requested document focus.
    return capRelationshipGraph(kbGraph, "summary");
  }
  // Document focus must switch the cockpit to document↔document topology.
  // Do not keep the KB-folder panorama under the ego overlay — that hides the
  // document layer the user selected (see home relations "库级全景" regression).
  return capRelationshipGraph(
    filterRelationshipGraph({
      graph: ego,
      query: params.query,
      focusNodeId: null,
    }),
    "document-ego",
  );
}

export function knowledgeObjectFromBundle(
  bundle: KnowledgeSourceBundle,
  params: { objectId: string },
): KnowledgeObject | null {
  return objectIndex(bundle).get(params.objectId) ?? null;
}

export async function knowledgeObject(
  client: GatewayClient | null,
  params: { objectId: string; knowledgeBaseId?: string | null },
): Promise<KnowledgeObject | null> {
  if (params.objectId.startsWith("obj:doc:")) {
    const { loadDocumentKnowledgeObjectByObjectId } =
      await import("./document-ego-graph-runtime.js");
    const context = await resolveKnowledgeSourceContext(client);
    const docObject = await loadDocumentKnowledgeObjectByObjectId({
      objectId: params.objectId,
      knowledgeBaseId: params.knowledgeBaseId ?? null,
      context,
      email: clientKnowledgeEmail(client),
    });
    if (docObject) {
      return docObject;
    }
  }
  const bundle = await loadKnowledgeBundle(client);
  return knowledgeObjectFromBundle(bundle, { objectId: params.objectId });
}

export function knowledgeObjectForNodeFromBundle(
  bundle: KnowledgeSourceBundle,
  nodeId: string,
): KnowledgeObject | null {
  const node = graphNodeIndex(bundle.graph).get(nodeId);
  if (!node?.objectId) {
    return null;
  }
  return knowledgeObjectFromBundle(bundle, { objectId: node.objectId });
}

export async function knowledgeObjectForNode(
  client: GatewayClient | null,
  nodeId: string,
  options?: { knowledgeBaseId?: string | null },
): Promise<KnowledgeObject | null> {
  if (nodeId.startsWith("node:obj:doc:")) {
    const objectId = nodeId.slice("node:".length);
    const { loadDocumentKnowledgeObjectByObjectId } =
      await import("./document-ego-graph-runtime.js");
    const context = await resolveKnowledgeSourceContext(client);
    const docObject = await loadDocumentKnowledgeObjectByObjectId({
      objectId,
      knowledgeBaseId: options?.knowledgeBaseId ?? null,
      context,
      email: clientKnowledgeEmail(client),
    });
    if (docObject) {
      return docObject;
    }
  }
  const bundle = await loadKnowledgeBundle(client);
  return knowledgeObjectForNodeFromBundle(bundle, nodeId);
}

export function knowledgeRecommendationsFromBundle(
  bundle: KnowledgeSourceBundle,
  params: {
    limit?: number;
    focusObjectId?: string | null;
    taskContext?: KnowledgeTaskContext | null;
  },
): KnowledgeRecommendation[] {
  return buildRelationshipRecommendations({
    objects: bundle.objects,
    graph: bundle.graph,
    taskContext: params.taskContext ?? null,
    focusObjectId: params.focusObjectId ?? null,
    limit: params.limit,
  });
}

export async function knowledgeRecommendations(
  client: GatewayClient | null,
  params: {
    limit?: number;
    focusObjectId?: string | null;
    taskContext?: KnowledgeTaskContext | null;
  },
): Promise<KnowledgeRecommendation[]> {
  // Compute from the shared bundle rather than materializing a second graph.
  const bundle = await loadKnowledgeBundle(client);
  return knowledgeRecommendationsFromBundle(bundle, params);
}

export function knowledgeRelatedFromBundle(
  bundle: KnowledgeSourceBundle,
  params: { objectId: string },
): KnowledgeRelatedGroups {
  return buildKnowledgeRelatedGroups({
    objectId: params.objectId,
    objects: bundle.objects,
    graph: bundle.graph,
  });
}

export async function knowledgeRelated(
  client: GatewayClient | null,
  params: { objectId: string },
): Promise<KnowledgeRelatedGroups> {
  const bundle = await loadKnowledgeBundle(client);
  return knowledgeRelatedFromBundle(bundle, params);
}

export async function knowledgeRecent(
  client: GatewayClient | null,
  params: { limit?: number },
): Promise<KnowledgeRecentVisit[]> {
  const context = await resolveKnowledgeSourceContext(client);
  return listKnowledgeRecentVisits({
    userId: context.userId,
    seatId: context.seatId,
    limit: params.limit,
  });
}

export async function knowledgeRecentRecord(
  client: GatewayClient | null,
  params: { objectId: string },
): Promise<{ visits: KnowledgeRecentVisit[] }> {
  const context = await resolveKnowledgeSourceContext(client);
  const bundle = await loadKnowledgeBundle(client);
  const object = objectIndex(bundle).get(params.objectId);
  if (!object) {
    return {
      visits: listKnowledgeRecentVisits({ userId: context.userId, seatId: context.seatId }),
    };
  }
  const visits = recordKnowledgeRecentVisit({
    userId: context.userId,
    seatId: context.seatId,
    object,
  });
  return { visits };
}

export async function knowledgeResolve(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
  },
): Promise<{
  objects: KnowledgeObject[];
  graph: RelationshipGraph;
  profile: KnowledgeAgentProfile;
  intent: Awaited<ReturnType<typeof runKnowledgeResolveEngine>>["intent"];
  selectedSources: Awaited<ReturnType<typeof runKnowledgeResolveEngine>>["selectedSources"];
  recommendations: KnowledgeRecommendation[];
}> {
  const resolved = await runKnowledgeResolveEngine(client, params);
  return {
    objects: resolved.objects,
    graph: resolved.graph,
    profile: resolved.profile,
    intent: resolved.intent,
    selectedSources: resolved.selectedSources,
    recommendations: resolved.recommendations,
  };
}

export async function knowledgeContext(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
  },
): Promise<KnowledgeAgentContext> {
  return runKnowledgeContextEngine(client, params);
}

export async function knowledgeAgentProfile(
  client: GatewayClient | null,
  params: { agentId?: string; taskContext?: KnowledgeTaskContext | null },
): Promise<KnowledgeAgentProfile> {
  const bundle = await loadKnowledgeBundle(client);
  const taskContext: KnowledgeTaskContext = params.taskContext ?? {
    taskType: "general",
    agentId: params.agentId ?? "default-agent",
  };
  const intent = classifyKnowledgeIntent({ taskContext });
  const selectedSources = selectKnowledgeSources({
    intent,
    taskContext,
    profile: buildKnowledgeAgentProfile({
      bundle,
      taskContext,
      selectedSources: intent.suggestedSources,
      intentConfidence: intent.confidence,
    }),
  });
  return buildKnowledgeAgentProfile({
    bundle,
    taskContext,
    selectedSources,
    intentConfidence: intent.confidence,
  });
}

export async function knowledgeFeedList(
  client: GatewayClient | null,
): Promise<{ feedItems: FeedItem[]; summary: ReturnType<typeof summarizeKnowledgeFeed> }> {
  const bundle = await loadKnowledgeBundle(client);
  return {
    feedItems: bundle.feedItems,
    summary: summarizeKnowledgeFeed({
      enterpriseAccessible: bundle.sourceBrowse.enterprise,
      enterpriseRestricted: bundle.sourceBrowse.enterpriseRestricted,
      dataObjects: bundle.objects.filter((item) => item.source === "data"),
      feedItems: bundle.feedItems,
    }),
  };
}

export async function knowledgeLineageExplain(
  client: GatewayClient | null,
  params: { objectId?: string; lineageId?: string },
): Promise<KnowledgeLineageExplain> {
  const context = await resolveKnowledgeSourceContext(client);
  if (!context.tenantId) {
    throw new Error("enterprise scope required for lineage explain");
  }
  const store = await loadEnterpriseDataStore(
    await resolveControlPlaneStorePathForClient(client, TENANT_ENTERPRISE_DATA_FILE),
  );
  const explain = explainKnowledgeLineage({
    store,
    tenantId: context.tenantId,
    objectId: params.objectId,
    lineageId: params.lineageId,
  });
  const accessible = canAccessEnterpriseFeedProjection({
    store,
    tenantId: context.tenantId,
    projectionId: explain.projectionId,
    context,
  });
  if (!accessible) {
    throw new EnterpriseDataStoreError("LINEAGE_NOT_FOUND", "Knowledge lineage record not found.");
  }
  return explain;
}

export async function knowledgeCognitiveBundle(
  client: GatewayClient | null,
  params: {
    taskContext: KnowledgeTaskContext;
    query?: string;
  },
): Promise<KnowledgeCognitiveBundle> {
  // Single composition pass (resolve + context computed once) so this RPC shares the
  // same Runtime Cognitive Context engine as the reply path and knowledge.runtime.context.
  const { resolve: resolved, context } = await runKnowledgeRuntimeEngine(client, params);
  const bundle = await loadKnowledgeBundle(client);
  const feedSummary = summarizeKnowledgeFeed({
    enterpriseAccessible: bundle.sourceBrowse.enterprise,
    enterpriseRestricted: bundle.sourceBrowse.enterpriseRestricted,
    dataObjects: bundle.objects.filter((item) => item.source === "data"),
    feedItems: bundle.feedItems,
  });
  return {
    profile: resolved.profile,
    resolved: {
      objects: filterObjectsForAgentConsumption(resolved.objects),
      graph: resolved.graph,
    },
    context: {
      primaryObjects: filterObjectsForAgentConsumption(context.primaryObjects),
      relatedObjects: filterObjectsForAgentConsumption(context.relatedObjects),
      recommendedCapabilities: filterObjectsForAgentConsumption(context.recommendedCapabilities),
      graph: context.graph,
    },
    feedSummary: {
      enterpriseAccessible: feedSummary.enterpriseAccessible,
      enterpriseRestricted: feedSummary.enterpriseRestricted,
      dataCapabilityCount: feedSummary.dataCapabilityCount,
      feedItemCount: feedSummary.feedItemCount,
    },
  };
}

export async function knowledgeDiscoveryList(
  client: GatewayClient | null,
  params: { limit?: number; lookbackMs?: number },
): Promise<KnowledgeDiscoveryEvent[]> {
  return listKnowledgeDiscoveryEvents({
    client,
    limit: params.limit,
    lookbackMs: params.lookbackMs,
  });
}

export async function knowledgeActionsList(
  client: GatewayClient | null,
  params: {
    limit?: number;
    knowledgeBaseId?: string | null;
    focusObjectId?: string | null;
    deliverableId?: string | null;
  },
): Promise<KnowledgeActionSuggestion[]> {
  return buildKnowledgeActionSuggestions({
    client,
    limit: params.limit,
    knowledgeBaseId: params.knowledgeBaseId,
    focusObjectId: params.focusObjectId,
    deliverableId: params.deliverableId,
  });
}
