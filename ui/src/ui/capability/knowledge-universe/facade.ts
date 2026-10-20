import type { GatewayBrowserClient } from "../../gateway.ts";
import type { KnowledgeUniverseHomeSnapshot } from "./endpoints.ts";
import { createKnowledgeUniverseGateway } from "./gateway-client.ts";
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

export async function loadKnowledgeUniverseHomeSnapshot(params: {
  client: GatewayBrowserClient | null | undefined;
  query?: string;
  selectedNodeId?: string | null;
  selectedKnowledgeBaseId?: string | null;
  focusDocumentId?: string | null;
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

  const [search, relationships, recommendations, discovery, actions, recent] = await Promise.all([
    gateway.search({ query }),
    gateway.relationships({
      query,
      focusNodeId: focusDocumentId ? null : (params.selectedNodeId ?? null),
      focusDocumentId,
      // Document ego when focusDocumentId set; otherwise library panorama when a
      // space folder is selected; global owner panorama when neither is set.
      knowledgeBaseId: kbScope,
    }),
    gateway.recommendations({ limit: 4, ...recommendationContext }),
    loadOptionalHomeInsight<{ events: KnowledgeDiscoveryEvent[] }>(
      gateway.discovery({ limit: 8 }),
      { events: [] },
    ),
    loadOptionalHomeInsight<{ actions: KnowledgeActionSuggestion[] }>(
      gateway.actions({
        limit: 4,
        knowledgeBaseId: kbScope,
        focusObjectId: null,
      }),
      { actions: [] },
    ),
    gateway.recent({ limit: 8 }),
  ]);

  let selectedObject: KnowledgeObject | null = null;
  let relatedGroups: KnowledgeRelatedGroups | null = null;
  let recentVisits = recent.visits;
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
