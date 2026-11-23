import type { KnowledgeEvidence } from "../../retrieval/types.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveKnowledgeSourceContext } from "./context.js";
import { getDeliverableArchiveKnowledgeBaseId } from "./deliverables/archive-store.js";
import { resolveDeliverableDocumentId } from "./deliverables/attach.js";
import { applyRuntimeGovernanceToDeliverables } from "./deliverables/governance-runtime.js";
import { listWorkspaceDeliverables } from "./deliverables/read-model.js";
import type { WorkspaceDeliverable } from "./deliverables/types.js";
import {
  knowledgeRelationshipsFromBundle,
  knowledgeSearch,
  loadKnowledgeBundle,
} from "./router.js";
import type {
  DataCapabilityDescriptor,
  KnowledgeObject,
  RelationshipGraph,
  RelationshipNode,
} from "./types.js";

export type WorkspaceSearchGroupId =
  | "knowledge"
  | "enterprise"
  | "deliverables"
  | "capabilities"
  | "agents"
  | "owners";

export type WorkspaceSearchHit = {
  id: string;
  group: WorkspaceSearchGroupId;
  title: string;
  subtitle?: string;
  score?: number;
  objectId?: string;
  nodeId?: string;
  deliverableId?: string;
  capabilityId?: string;
  docId?: string;
  kbId?: string;
  /** Runtime trust state for product surfaces (deliverables, evidence, objects). */
  governanceStatus?: "verified" | "pending" | "conflict";
  governanceClaimConflict?: boolean;
};

export type WorkspaceSearchGroup = {
  group: WorkspaceSearchGroupId;
  hits: WorkspaceSearchHit[];
};

export type WorkspaceSearchMode = "indexed" | "substring" | "mixed";

export type WorkspaceSearchResponse = {
  query: string;
  searchMode: WorkspaceSearchMode;
  totalCount: number;
  groups: WorkspaceSearchGroup[];
  legacyResults: KnowledgeObject[];
};

export type WorkspaceSearchParams = {
  query?: string;
  limitPerGroup?: number;
};

const GROUP_ORDER: WorkspaceSearchGroupId[] = [
  "knowledge",
  "enterprise",
  "deliverables",
  "capabilities",
  "agents",
  "owners",
];

function normalizeQuery(query: string | undefined): string {
  return (query ?? "").trim();
}

function normalizeLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 5, 1), 20);
}

function matchesHaystack(parts: Array<string | undefined>, query: string): boolean {
  const haystack = parts
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function resolveNodeIdForObject(graph: RelationshipGraph, objectId: string): string | undefined {
  return graph.nodes.find((node) => node.objectId === objectId)?.id;
}

function resolveEvidenceTrustStatus(
  evidence: KnowledgeEvidence,
): "verified" | "pending" | "conflict" | undefined {
  if (evidence.governanceClaimConflict || evidence.governanceConflict) {
    return "conflict";
  }
  if (evidence.governanceStatus === "pending") {
    return "pending";
  }
  if (evidence.governanceStatus === "suppressed") {
    return "pending";
  }
  if (
    evidence.governanceStatus === "confirmed" ||
    evidence.governanceStatus === "merged" ||
    evidence.governanceStatus === "archived"
  ) {
    return "verified";
  }
  return undefined;
}

function resolveObjectTrustStatus(
  object: KnowledgeObject,
): "verified" | "pending" | "conflict" | undefined {
  const conflictCount = object.relationshipSummary?.conflictCount ?? 0;
  if (conflictCount > 0) {
    return "conflict";
  }
  if (object.freshnessStatus === "stale" || object.freshnessStatus === "expired") {
    return "pending";
  }
  return undefined;
}

function evidenceToHit(evidence: KnowledgeEvidence): WorkspaceSearchHit {
  const excerpt = evidence.chunkText.trim().slice(0, 120);
  const governanceStatus = resolveEvidenceTrustStatus(evidence);
  return {
    id: `evidence:${evidence.kbId}:${evidence.docId}:${evidence.versionId}:${evidence.score}`,
    group: "knowledge",
    title: evidence.docTitle,
    subtitle: excerpt.length < evidence.chunkText.trim().length ? `${excerpt}…` : excerpt,
    score: evidence.score,
    docId: evidence.docId,
    kbId: evidence.kbId,
    ...(governanceStatus ? { governanceStatus } : undefined),
    ...(evidence.governanceClaimConflict ? { governanceClaimConflict: true } : undefined),
  };
}

function objectToHit(params: {
  object: KnowledgeObject;
  group: "knowledge" | "enterprise";
  graph: RelationshipGraph;
}): WorkspaceSearchHit {
  const governanceStatus = resolveObjectTrustStatus(params.object);
  return {
    id: `object:${params.object.id}`,
    group: params.group,
    title: params.object.title,
    subtitle: params.object.summary?.trim() || undefined,
    objectId: params.object.id,
    nodeId: resolveNodeIdForObject(params.graph, params.object.id),
    ...(governanceStatus ? { governanceStatus } : undefined),
  };
}

function deliverableToHit(
  item: WorkspaceDeliverable,
  subtitleOverride?: string,
): WorkspaceSearchHit {
  const subtitleParts = [item.kind, item.source, item.groupTitle, item.creators.join(", ")].filter(
    Boolean,
  );
  return {
    id: `deliverable:${item.deliverableId}`,
    group: "deliverables",
    title: item.title,
    subtitle: subtitleOverride ?? subtitleParts.join(" · "),
    deliverableId: item.deliverableId,
    governanceStatus: item.governanceStatus,
  };
}

function buildDeliverableDocLookup(
  deliverables: WorkspaceDeliverable[],
): Map<string, WorkspaceDeliverable> {
  const map = new Map<string, WorkspaceDeliverable>();
  for (const item of deliverables) {
    const docId = resolveDeliverableDocumentId(item.deliverableId);
    if (docId) {
      map.set(docId, item);
      const kbId =
        item.relatedKnowledgeBaseId ?? getDeliverableArchiveKnowledgeBaseId(item.deliverableId);
      if (kbId) {
        const canonical = resolveDeliverableDocumentId(item.deliverableId, kbId);
        if (canonical) {
          map.set(canonical, item);
        }
      }
    }
  }
  return map;
}

function deliverableHitsFromEvidence(params: {
  evidence: KnowledgeEvidence[];
  deliverables: WorkspaceDeliverable[];
  limit: number;
}): WorkspaceSearchHit[] {
  const byDocId = buildDeliverableDocLookup(params.deliverables);
  const seen = new Set<string>();
  const hits: WorkspaceSearchHit[] = [];
  for (const item of params.evidence) {
    const deliverable = byDocId.get(item.docId);
    if (!deliverable || seen.has(deliverable.deliverableId)) {
      continue;
    }
    seen.add(deliverable.deliverableId);
    const excerpt = item.chunkText.trim().slice(0, 120);
    const subtitle =
      excerpt.length < item.chunkText.trim().length ? `${excerpt}…` : excerpt || undefined;
    hits.push({
      ...deliverableToHit(deliverable, subtitle),
      score: item.score,
    });
    if (hits.length >= params.limit) {
      break;
    }
  }
  return hits;
}

function mergeDeliverableHits(params: {
  indexed: WorkspaceSearchHit[];
  substring: WorkspaceSearchHit[];
  limit: number;
}): WorkspaceSearchHit[] {
  const merged = new Map<string, WorkspaceSearchHit>();
  for (const hit of params.indexed) {
    if (hit.deliverableId) {
      merged.set(hit.deliverableId, hit);
    }
  }
  for (const hit of params.substring) {
    if (hit.deliverableId && !merged.has(hit.deliverableId)) {
      merged.set(hit.deliverableId, hit);
    }
  }
  return [...merged.values()].slice(0, params.limit);
}

function capabilityToHit(item: DataCapabilityDescriptor): WorkspaceSearchHit {
  return {
    id: `capability:${item.id}`,
    group: "capabilities",
    title: item.title,
    subtitle: item.summary?.trim() || item.scenarios.slice(0, 2).join(" · ") || undefined,
    capabilityId: item.id,
  };
}

function graphNodeToHit(node: RelationshipNode, group: "agents" | "owners"): WorkspaceSearchHit {
  return {
    id: `node:${node.id}`,
    group,
    title: node.title,
    subtitle: node.summary?.trim() || undefined,
    nodeId: node.id,
    objectId: node.objectId,
  };
}

export function buildWorkspaceSearchGroups(params: {
  query: string;
  limitPerGroup: number;
  graph: RelationshipGraph;
  knowledgeObjects: KnowledgeObject[];
  evidence: KnowledgeEvidence[];
  deliverables: WorkspaceDeliverable[];
  dataCapabilities: DataCapabilityDescriptor[];
}): WorkspaceSearchGroup[] {
  const query = params.query.trim();
  if (!query) {
    return GROUP_ORDER.map((group) => ({ group, hits: [] }));
  }

  const personalObjects = params.knowledgeObjects.filter(
    (item) => item.source === "personal" || item.source === "data",
  );
  const enterpriseObjects = params.knowledgeObjects.filter((item) => item.source === "enterprise");

  const knowledgeHits: WorkspaceSearchHit[] = [
    ...params.evidence.map((item) => evidenceToHit(item)),
    ...personalObjects
      .filter((item) =>
        matchesHaystack([item.title, item.summary, item.tags.join(" "), item.kind], query),
      )
      .map((item) => objectToHit({ object: item, group: "knowledge", graph: params.graph })),
  ].slice(0, params.limitPerGroup);

  const enterpriseHits = enterpriseObjects
    .filter((item) =>
      matchesHaystack([item.title, item.summary, item.tags.join(" "), item.kind], query),
    )
    .slice(0, params.limitPerGroup)
    .map((item) => objectToHit({ object: item, group: "enterprise", graph: params.graph }));

  const indexedDeliverableHits = deliverableHitsFromEvidence({
    evidence: params.evidence,
    deliverables: params.deliverables,
    limit: params.limitPerGroup,
  });
  const substringDeliverableHits = params.deliverables
    .filter((item) =>
      matchesHaystack(
        [item.title, item.kind, item.source, item.groupTitle, item.creators.join(" ")],
        query,
      ),
    )
    .slice(0, params.limitPerGroup)
    .map((item) => deliverableToHit(item));
  const deliverableHits = mergeDeliverableHits({
    indexed: indexedDeliverableHits,
    substring: substringDeliverableHits,
    limit: params.limitPerGroup,
  });

  const capabilityHits = params.dataCapabilities
    .filter((item) =>
      matchesHaystack(
        [item.title, item.summary, item.scenarios.join(" "), item.sourceSystems.join(" ")],
        query,
      ),
    )
    .slice(0, params.limitPerGroup)
    .map((item) => capabilityToHit(item));

  const agentHits = params.graph.nodes
    .filter((node) => node.kind === "agent")
    .filter((node) => matchesHaystack([node.title, node.summary], query))
    .slice(0, params.limitPerGroup)
    .map((node) => graphNodeToHit(node, "agents"));

  const ownerHits = params.graph.nodes
    .filter((node) => node.kind === "owner")
    .filter((node) => matchesHaystack([node.title, node.summary], query))
    .slice(0, params.limitPerGroup)
    .map((node) => graphNodeToHit(node, "owners"));

  const grouped: Record<WorkspaceSearchGroupId, WorkspaceSearchHit[]> = {
    knowledge: knowledgeHits,
    enterprise: enterpriseHits,
    deliverables: deliverableHits,
    capabilities: capabilityHits,
    agents: agentHits,
    owners: ownerHits,
  };

  return GROUP_ORDER.map((group) => ({ group, hits: grouped[group] }));
}

function resolveSearchMode(params: {
  evidenceCount: number;
  objectCount: number;
}): WorkspaceSearchMode {
  if (params.evidenceCount > 0 && params.objectCount > 0) {
    return "mixed";
  }
  if (params.evidenceCount > 0) {
    return "indexed";
  }
  return "substring";
}

export async function searchWorkspace(
  client: GatewayClient | null,
  params: WorkspaceSearchParams,
): Promise<WorkspaceSearchResponse> {
  const query = normalizeQuery(params.query);
  const limitPerGroup = normalizeLimit(params.limitPerGroup);
  if (!query) {
    return {
      query,
      searchMode: "substring",
      totalCount: 0,
      groups: GROUP_ORDER.map((group) => ({ group, hits: [] })),
      legacyResults: [],
    };
  }

  const bundle = await loadKnowledgeBundle(client);
  const graph = knowledgeRelationshipsFromBundle(bundle, { query });
  const search = await knowledgeSearch(client, { query, limit: limitPerGroup * 4 });
  const evidence = search.evidence ?? [];
  const knowledgeObjects = search.results;

  const context = await resolveKnowledgeSourceContext(client);
  const rawDeliverables =
    context.userId != null
      ? (
          await listWorkspaceDeliverables({
            userId: context.userId,
            limit: 100,
          })
        ).deliverables
      : [];
  const deliverables =
    context.userId != null
      ? await applyRuntimeGovernanceToDeliverables({
          deliverables: rawDeliverables,
          ownerId: context.userId,
          tenantId: context.tenantId,
        })
      : rawDeliverables;

  const groups = buildWorkspaceSearchGroups({
    query,
    limitPerGroup,
    graph,
    knowledgeObjects,
    evidence,
    deliverables,
    dataCapabilities: search.dataCapabilities ?? bundle.dataCapabilities,
  });

  const totalCount = groups.reduce((sum, group) => sum + group.hits.length, 0);
  const legacyResults = [
    ...knowledgeObjects.filter((item) => item.source !== "enterprise"),
    ...(groups
      .find((group) => group.group === "enterprise")
      ?.hits.filter((hit) => hit.objectId)
      .map((hit) => knowledgeObjects.find((item) => item.id === hit.objectId))
      .filter((item): item is KnowledgeObject => Boolean(item)) ?? []),
  ];

  return {
    query,
    searchMode: resolveSearchMode({
      evidenceCount: evidence.length,
      objectCount: knowledgeObjects.length,
    }),
    totalCount,
    groups,
    legacyResults,
  };
}
