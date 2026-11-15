import type { KnowledgeUniverseHomeSnapshot } from "./endpoints.ts";
import {
  createKnowledgeUniverseGateway,
  type KnowledgeUniverseRpcClient,
} from "./gateway-client.ts";
import { buildHomeGraphViewModel } from "./graph-layout.ts";
import type {
  KnowledgeActionSuggestion,
  KnowledgeDiscoveryEvent,
  KnowledgeObject,
  KnowledgeRelatedGroups,
} from "./types.ts";

function isOptionalHomeInsightMethodError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown method:\s*knowledge\.(actions|discovery)\./i.test(message);
}

export type KnowledgeUniverseHomeSettledField =
  | "search"
  | "relationships"
  | "recommendations"
  | "discovery"
  | "actions"
  | "recent"
  | "focus";

export type KnowledgeUniverseHomePartialSnapshot = Partial<KnowledgeUniverseHomeSnapshot> & {
  query: string;
  settled: KnowledgeUniverseHomeSettledField[];
};

/**
 * Load the knowledge-universe home snapshot without blocking the page on a single
 * Promise.all. Lightweight fields and each of search / relationships /
 * recommendations / actions settle independently and can be applied in completion
 * order via `onPartial`. Discovery and actions still degrade when the gateway
 * method is missing.
 */
export async function loadKnowledgeUniverseHomeSnapshot(params: {
  client: KnowledgeUniverseRpcClient | null | undefined;
  query?: string;
  selectedNodeId?: string | null;
  selectedKnowledgeBaseId?: string | null;
  focusDocumentId?: string | null;
  onPartial?: (partial: KnowledgeUniverseHomePartialSnapshot) => void;
}): Promise<KnowledgeUniverseHomeSnapshot> {
  const gateway = createKnowledgeUniverseGateway(params.client);
  const query = (params.query ?? "").trim();
  const kbScope = params.selectedKnowledgeBaseId?.trim() || null;
  const focusDocumentId = params.focusDocumentId?.trim() || null;
  const recommendationContext = kbScope
    ? { taskContext: { taskType: "workspace", knowledgeBaseId: kbScope } }
    : {};
  let homeInsightsDegraded = false;

  async function loadOptionalHomeInsight<T>(promise: Promise<T>, fallback: T): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (isOptionalHomeInsightMethodError(error)) {
        homeInsightsDegraded = true;
        return fallback;
      }
      throw error;
    }
  }

  const settled: KnowledgeUniverseHomeSettledField[] = [];
  const draft: KnowledgeUniverseHomePartialSnapshot = {
    query,
    settled,
    relatedGroups: null,
    selectedNodeId: params.selectedNodeId ?? null,
    selectedObject: null,
    homeInsightsDegraded: false,
  };

  const emit = (field: KnowledgeUniverseHomeSettledField) => {
    if (!settled.includes(field)) {
      settled.push(field);
    }
    draft.settled = [...settled];
    draft.homeInsightsDegraded = homeInsightsDegraded;
    params.onPartial?.({ ...draft, settled: [...settled] });
  };

  const searchP = gateway.search({ query }).then((search) => {
    draft.sourceSummary = search.sourceSummary;
    draft.searchResults = search.results;
    draft.dataCapabilities = search.dataCapabilities ?? [];
    draft.sourceBrowse = search.sourceBrowse ?? {
      personal: [],
      enterprise: [],
      enterpriseRestricted: [],
    };
    draft.externalDataSources = search.externalDataSources ?? [];
    emit("search");
    return search;
  });

  const relationshipsP = gateway
    .relationships({
      query,
      focusNodeId: focusDocumentId ? null : (params.selectedNodeId ?? null),
      focusDocumentId,
      // Document ego when focusDocumentId set; otherwise library panorama when a
      // space folder is selected; capped summary when neither is set.
      knowledgeBaseId: kbScope,
    })
    .then((relationships) => {
      draft.graph = relationships.graph;
      draft.graphViewModel = buildHomeGraphViewModel(relationships.graph);
      emit("relationships");
      return relationships;
    });

  const recommendationsP = gateway
    .recommendations({ limit: 4, ...recommendationContext })
    .then((recommendations) => {
      draft.recommendations = recommendations.recommendations;
      emit("recommendations");
      return recommendations;
    });

  const discoveryP = loadOptionalHomeInsight<{ events: KnowledgeDiscoveryEvent[] }>(
    gateway.discovery({ limit: 8 }),
    { events: [] },
  ).then((discovery) => {
    draft.discoveryEvents = discovery.events;
    emit("discovery");
    return discovery;
  });

  const actionsP = loadOptionalHomeInsight<{ actions: KnowledgeActionSuggestion[] }>(
    gateway.actions({
      limit: 4,
      knowledgeBaseId: kbScope,
      focusObjectId: null,
    }),
    { actions: [] },
  ).then((actions) => {
    draft.actionSuggestions = actions.actions;
    emit("actions");
    return actions;
  });

  const recentP = gateway.recent({ limit: 8 }).then((recent) => {
    draft.recentVisits = recent.visits;
    emit("recent");
    return recent;
  });

  const [search, relationships, recommendations, discovery, actions, recent] = await Promise.all([
    searchP,
    relationshipsP,
    recommendationsP,
    discoveryP,
    actionsP,
    recentP,
  ]);

  let selectedObject: KnowledgeObject | null = draft.selectedObject ?? null;
  let relatedGroups: KnowledgeRelatedGroups | null = draft.relatedGroups ?? null;
  let recentVisits = draft.recentVisits ?? recent.visits;
  if (params.selectedNodeId) {
    const objectResponse = await gateway.object({
      nodeId: params.selectedNodeId,
      knowledgeBaseId: kbScope,
    });
    selectedObject = objectResponse?.object ?? null;
    if (!selectedObject && focusDocumentId) {
      // Never fall back to nodes[0] — merged KB∪ego graphs put KB nodes first and that
      // desyncs the cockpit anchor from the document the user selected.
      const center =
        relationships.graph.nodes.find((node) => node.id === params.selectedNodeId) ?? null;
      if (center) {
        const incident = relationships.graph.edges.filter(
          (edge) => edge.sourceId === center.id || edge.targetId === center.id,
        );
        selectedObject = {
          id: center.objectId ?? `obj:doc:${focusDocumentId}`,
          title: center.title,
          source: "personal",
          kind: "document",
          summary: center.summary ?? "",
          tags: ["文档"],
          updatedAt: Date.now(),
          scopeLabel: "知识库文档",
          relationshipSummary: {
            relatedCount: incident.length,
            conflictCount: incident.filter((edge) => edge.relationType === "conflicts").length,
            supportingCount: incident.filter((edge) => edge.relationType === "supports").length,
          },
        };
      }
    }
    if (selectedObject) {
      const [related, recorded] = await Promise.all([
        gateway.related({ objectId: selectedObject.id }).catch(() => null),
        gateway
          .recordRecent({ objectId: selectedObject.id })
          .catch(() => ({ visits: recentVisits })),
      ]);
      relatedGroups = related;
      recentVisits = recorded?.visits ?? recentVisits;
      const focusRecommendations = await gateway.recommendations({
        limit: 4,
        focusObjectId: selectedObject.id,
        ...recommendationContext,
      });
      const focusActions = await loadOptionalHomeInsight<{ actions: KnowledgeActionSuggestion[] }>(
        gateway.actions({
          limit: 4,
          focusObjectId: selectedObject.id,
          knowledgeBaseId: kbScope,
        }),
        { actions: [] },
      );
      draft.recommendations = focusRecommendations.recommendations;
      draft.actionSuggestions = focusActions.actions;
      draft.relatedGroups = relatedGroups;
      draft.recentVisits = recentVisits;
      draft.selectedObject = selectedObject;
      emit("focus");
      return {
        query,
        sourceSummary: search.sourceSummary,
        graph: relationships.graph,
        graphViewModel: buildHomeGraphViewModel(relationships.graph),
        searchResults: search.results,
        dataCapabilities: search.dataCapabilities ?? [],
        sourceBrowse: search.sourceBrowse ?? {
          personal: [],
          enterprise: [],
          enterpriseRestricted: [],
        },
        externalDataSources: search.externalDataSources ?? [],
        recommendations: focusRecommendations.recommendations,
        discoveryEvents: discovery.events,
        actionSuggestions: focusActions.actions,
        recentVisits,
        relatedGroups,
        selectedNodeId: params.selectedNodeId ?? null,
        selectedObject,
        homeInsightsDegraded,
      };
    }
  }

  return {
    query,
    sourceSummary: search.sourceSummary,
    graph: relationships.graph,
    graphViewModel: buildHomeGraphViewModel(relationships.graph),
    searchResults: search.results,
    dataCapabilities: search.dataCapabilities ?? [],
    sourceBrowse: search.sourceBrowse ?? { personal: [], enterprise: [], enterpriseRestricted: [] },
    externalDataSources: search.externalDataSources ?? [],
    recommendations: recommendations.recommendations,
    discoveryEvents: discovery.events,
    actionSuggestions: actions.actions,
    recentVisits,
    relatedGroups,
    selectedNodeId: params.selectedNodeId ?? null,
    selectedObject,
    homeInsightsDegraded,
  };
}
