import type { EventLoopYielder } from "../event-loop-yield.js";
import { listExplicitDocumentMetadata } from "../explicit-metadata-store.js";
import type {
  DataCapabilityDescriptor,
  KnowledgeObject,
  RelationshipEdge,
  RelationshipGraph,
  RelationshipNode,
  RelationshipNodeGovernanceStatus,
} from "../types.js";
import { enrichKnowledgeObjectsWithExplicitMetadata } from "./explicit-graph-enrichment.js";
import {
  buildCandidateRelationships,
  buildCandidateRelationshipsAsync,
} from "./relationship-builder.js";
import {
  detectRelationshipConflicts,
  detectRelationshipConflictsAsync,
} from "./relationship-conflict-detector.js";
import { scoreRelationshipCandidates } from "./relationship-score-engine.js";
import type { RelationshipRuntimeInput, RelationshipRuntimeResult } from "./types.js";

const HUB_NODES = {
  me: { id: "node:me", kind: "owner" as const, title: "我" },
  personal: {
    id: "node:hub:personal",
    kind: "knowledge-object" as const,
    title: "我的知识",
    objectId: "obj:hub:personal",
  },
  enterprise: {
    id: "node:hub:enterprise",
    kind: "knowledge-object" as const,
    title: "企业知识",
    objectId: "obj:hub:enterprise",
  },
  data: {
    id: "node:hub:data",
    kind: "data-capability" as const,
    title: "数据能力",
    objectId: "obj:hub:data",
  },
};

/**
 * Canonical graph-node id for a knowledge object. Exported so projection sources
 * (e.g. knowledge-index-source) can emit explicit edges that target the same node
 * ids the runtime produces for their objects.
 */
export function nodeIdForObject(objectId: string): string {
  return `node:${objectId}`;
}

function nodeKindForObject(object: KnowledgeObject): RelationshipNode["kind"] {
  // KB-space and archived-deliverable projections carry distinct node kinds so the
  // graph can render them apart from generic knowledge objects (see knowledge-index-source).
  if (object.id.startsWith("obj:kb:")) {
    return "knowledge-base";
  }
  if (object.id.startsWith("obj:deliverable:")) {
    return "deliverable";
  }
  if (object.source === "data") {
    return "data-capability";
  }
  if (object.kind === "project") {
    return "project";
  }
  if (object.id.startsWith("obj:agent:")) {
    return "agent";
  }
  if (object.tags.some((tag) => tag === "负责人" || tag.toLowerCase() === "owner")) {
    return "owner";
  }
  return "knowledge-object";
}

function pushEdge(edges: RelationshipEdge[], edge: RelationshipEdge) {
  if (edge.sourceId === edge.targetId) {
    return;
  }
  const exists = edges.some(
    (item) =>
      (item.sourceId === edge.sourceId &&
        item.targetId === edge.targetId &&
        item.relationType === edge.relationType) ||
      (item.sourceId === edge.targetId &&
        item.targetId === edge.sourceId &&
        item.relationType === edge.relationType),
  );
  if (!exists) {
    edges.push(edge);
  }
}

function ensureAgentNodes(params: {
  objects: KnowledgeObject[];
  dataCapabilities: DataCapabilityDescriptor[];
  nodes: RelationshipNode[];
}): KnowledgeObject[] {
  const extras: KnowledgeObject[] = [];
  const existingIds = new Set(params.objects.map((item) => item.id));
  for (const capability of params.dataCapabilities) {
    for (const agentId of capability.visibleAgents) {
      const objectId = `obj:agent:${agentId}`;
      if (existingIds.has(objectId)) {
        continue;
      }
      existingIds.add(objectId);
      const object: KnowledgeObject = {
        id: objectId,
        title: agentId,
        source: "data",
        kind: "insight",
        summary: `消费数据能力 ${capability.title}`,
        tags: ["机器人"],
        updatedAt: Date.now(),
        scopeLabel: "岗位机器人",
      };
      extras.push(object);
      params.nodes.push({
        id: nodeIdForObject(objectId),
        kind: "agent",
        title: object.title,
        summary: object.summary,
        objectId,
      });
    }
  }
  return extras;
}

function summarizeObjectRelationships(params: {
  objectId: string;
  graph: RelationshipGraph;
  conflictCount: number;
}): KnowledgeObject["relationshipSummary"] {
  const nodeId = nodeIdForObject(params.objectId);
  let relatedCount = 0;
  let supportingCount = 0;
  for (const edge of params.graph.edges) {
    if (edge.sourceId !== nodeId && edge.targetId !== nodeId) {
      continue;
    }
    relatedCount += 1;
    if (edge.relationType === "supports" || edge.relationType === "recommended-for") {
      supportingCount += 1;
    }
  }
  return {
    relatedCount,
    conflictCount: params.conflictCount,
    supportingCount,
  };
}

const RELATIONSHIP_RUNTIME_CACHE_MAX = 16;
const relationshipRuntimeCache = new Map<string, RelationshipRuntimeResult>();

/** FNV-1a 32-bit string hash — cheap, dependency-free signature for memoization. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Stable signature over only the inputs the graph build reads. Object order is
 * deterministic across loads (personal → feed), so an unchanged knowledge set
 * yields the same signature → cache hit → no O(n^2) rebuild.
 */
function relationshipRuntimeSignature(input: RelationshipRuntimeInput): string {
  const objectParts = input.objects.map((object) =>
    [
      object.id,
      object.source,
      object.kind,
      object.updatedAt,
      object.title,
      object.summary,
      (object.tags ?? []).join("|"),
      (object.relatedObjectIds ?? []).join("|"),
    ].join("\u0001"),
  );
  const capabilityParts = (input.dataCapabilities ?? []).map((capability) =>
    [capability.id, (capability.visibleAgents ?? []).join("|")].join("\u0001"),
  );
  return fnv1a(`${objectParts.join("\u0002")}\u0003${capabilityParts.join("\u0002")}`);
}

/** Test/maintenance hook to drop the memoized graph cache. */
export function clearRelationshipRuntimeCache(): void {
  relationshipRuntimeCache.clear();
}

/**
 * Memoized entry point. The object-level relationship graph is rebuilt only when
 * the underlying knowledge set actually changes; repeated loads of an unchanged
 * set reuse the previously computed graph (LRU-bounded), avoiding a full rebuild.
 */
function rememberRelationshipRuntimeResult(
  signature: string,
  result: RelationshipRuntimeResult,
): RelationshipRuntimeResult {
  relationshipRuntimeCache.set(signature, result);
  if (relationshipRuntimeCache.size > RELATIONSHIP_RUNTIME_CACHE_MAX) {
    const oldest = relationshipRuntimeCache.keys().next().value;
    if (oldest !== undefined) {
      relationshipRuntimeCache.delete(oldest);
    }
  }
  return result;
}

function takeCachedRelationshipRuntimeResult(signature: string): RelationshipRuntimeResult | null {
  const cached = relationshipRuntimeCache.get(signature);
  if (!cached) {
    return null;
  }
  relationshipRuntimeCache.delete(signature);
  relationshipRuntimeCache.set(signature, cached);
  return cached;
}

export function buildIntelligentRelationshipGraph(
  input: RelationshipRuntimeInput,
): RelationshipRuntimeResult {
  const signature = relationshipRuntimeSignature(input);
  const cached = takeCachedRelationshipRuntimeResult(signature);
  if (cached) {
    return cached;
  }
  return rememberRelationshipRuntimeResult(signature, computeIntelligentRelationshipGraph(input));
}

export async function buildIntelligentRelationshipGraphAsync(
  input: RelationshipRuntimeInput,
  options?: { yieldFn?: EventLoopYielder; yieldEvery?: number },
): Promise<RelationshipRuntimeResult> {
  const signature = relationshipRuntimeSignature(input);
  const cached = takeCachedRelationshipRuntimeResult(signature);
  if (cached) {
    return cached;
  }
  const result = await computeIntelligentRelationshipGraphAsync(input, options);
  return rememberRelationshipRuntimeResult(signature, result);
}

function prepareIntelligentRelationshipGraph(input: RelationshipRuntimeInput): {
  objects: KnowledgeObject[];
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  dataCapabilities: DataCapabilityDescriptor[];
  explicitMetadata: ReturnType<typeof listExplicitDocumentMetadata>;
} {
  const nodes: RelationshipNode[] = [HUB_NODES.me];
  const edges: RelationshipEdge[] = [];
  const dataCapabilities = input.dataCapabilities ?? [];
  // P2: merge Obsidian tags / wikilink-related ids before graph construction.
  // Only attach metadata for docIds present in this object set (no title fallback).
  // Prefer knowledgeBaseId filter when KB-space nodes are present; otherwise match by docId only.
  const objectIdKeys = new Set(
    input.objects.flatMap((object) => [
      object.id,
      object.id.replace(/^obj:personal:/, ""),
      object.id.replace(/^obj:/, ""),
    ]),
  );
  const kbIds = [
    ...new Set(
      input.objects
        .filter((object) => object.id.startsWith("obj:kb:"))
        .map((object) => object.id.slice("obj:kb:".length)),
    ),
  ];
  const scopedMeta =
    kbIds.length > 0
      ? kbIds.flatMap((knowledgeBaseId) => listExplicitDocumentMetadata({ knowledgeBaseId }))
      : listExplicitDocumentMetadata();
  const explicitMetadata = scopedMeta.filter(
    (record) =>
      objectIdKeys.has(record.docId) ||
      // Keep records for docs in the same KBs even if not projected as graph objects yet
      // only when kb filter was applied above.
      (kbIds.length > 0 && record.knowledgeBaseId && kbIds.includes(record.knowledgeBaseId)),
  );
  const enrichedInputObjects = enrichKnowledgeObjectsWithExplicitMetadata({
    objects: input.objects,
    metadataRecords: explicitMetadata,
  });
  const agentExtras = ensureAgentNodes({
    objects: enrichedInputObjects,
    dataCapabilities,
    nodes,
  });
  const objects = [...enrichedInputObjects, ...agentExtras];
  const personal = objects.filter((item) => item.source === "personal");
  const enterprise = objects.filter((item) => item.source === "enterprise");
  const data = objects.filter((item) => item.source === "data");

  if (personal.length) {
    nodes.push(HUB_NODES.personal);
    pushEdge(edges, {
      sourceId: HUB_NODES.me.id,
      targetId: HUB_NODES.personal.id,
      relationType: "related",
      score: 92,
    });
  }
  if (enterprise.length) {
    nodes.push(HUB_NODES.enterprise);
    pushEdge(edges, {
      sourceId: HUB_NODES.me.id,
      targetId: HUB_NODES.enterprise.id,
      relationType: "related",
      score: 90,
    });
  }
  if (data.length) {
    nodes.push(HUB_NODES.data);
    pushEdge(edges, {
      sourceId: HUB_NODES.me.id,
      targetId: HUB_NODES.data.id,
      relationType: "related",
      score: 88,
    });
  }

  for (const object of objects) {
    if (nodes.some((node) => node.objectId === object.id)) {
      continue;
    }
    const nodeId = nodeIdForObject(object.id);
    nodes.push({
      id: nodeId,
      kind: nodeKindForObject(object),
      title: object.title,
      summary: object.summary,
      objectId: object.id,
    });
    const hubId =
      object.source === "personal"
        ? HUB_NODES.personal.id
        : object.source === "enterprise"
          ? HUB_NODES.enterprise.id
          : HUB_NODES.data.id;
    if (nodes.some((node) => node.id === hubId)) {
      pushEdge(edges, {
        sourceId: hubId,
        targetId: nodeId,
        relationType: object.source === "data" ? "used-by" : "supports",
        score: 78,
      });
    } else {
      pushEdge(edges, {
        sourceId: HUB_NODES.me.id,
        targetId: nodeId,
        relationType: "related",
        score: 70,
      });
    }
  }

  return { objects, nodes, edges, dataCapabilities, explicitMetadata };
}

function computeIntelligentRelationshipGraph(
  input: RelationshipRuntimeInput,
): RelationshipRuntimeResult {
  const { objects, nodes, edges, dataCapabilities, explicitMetadata } =
    prepareIntelligentRelationshipGraph(input);
  const scoredCandidates = scoreRelationshipCandidates({
    candidates: buildCandidateRelationships({
      objects,
      dataCapabilities,
      explicitMetadata,
    }),
    objects,
  });
  const conflicts = detectRelationshipConflicts(objects);
  return finalizeIntelligentRelationshipGraph({
    input,
    objects,
    nodes,
    edges,
    scoredCandidates,
    conflicts,
  });
}

async function computeIntelligentRelationshipGraphAsync(
  input: RelationshipRuntimeInput,
  options?: { yieldFn?: EventLoopYielder; yieldEvery?: number },
): Promise<RelationshipRuntimeResult> {
  const prepared = prepareIntelligentRelationshipGraph(input);
  if (options?.yieldFn) {
    await options.yieldFn();
  }
  const scoredCandidates = scoreRelationshipCandidates({
    candidates: await buildCandidateRelationshipsAsync(
      {
        objects: prepared.objects,
        dataCapabilities: prepared.dataCapabilities,
        explicitMetadata: prepared.explicitMetadata,
      },
      options,
    ),
    objects: prepared.objects,
  });
  const conflicts = await detectRelationshipConflictsAsync(prepared.objects, options);
  if (options?.yieldFn) {
    await options.yieldFn();
  }
  return finalizeIntelligentRelationshipGraph({
    input,
    objects: prepared.objects,
    nodes: prepared.nodes,
    edges: prepared.edges,
    scoredCandidates,
    conflicts,
  });
}

function finalizeIntelligentRelationshipGraph(params: {
  input: RelationshipRuntimeInput;
  objects: KnowledgeObject[];
  nodes: RelationshipNode[];
  edges: RelationshipEdge[];
  scoredCandidates: ReturnType<typeof scoreRelationshipCandidates>;
  conflicts: ReturnType<typeof detectRelationshipConflicts>;
}): RelationshipRuntimeResult {
  const { input, objects, nodes, edges, scoredCandidates, conflicts } = params;
  for (const candidate of scoredCandidates) {
    pushEdge(edges, {
      sourceId: nodeIdForObject(candidate.sourceObjectId),
      targetId: nodeIdForObject(candidate.targetObjectId),
      relationType: candidate.relationType,
      score: candidate.score,
      // Carry the candidate's reason tokens so the UI can explain *why* two nodes connect.
      reasons: candidate.reasons,
    });
  }

  for (const conflict of conflicts) {
    pushEdge(edges, {
      sourceId: nodeIdForObject(conflict.leftId),
      targetId: nodeIdForObject(conflict.rightId),
      relationType: "conflicts",
      score: 66,
      reasons: [`conflict:${conflict.reason}`],
    });
  }

  const graph: RelationshipGraph = { nodes, edges };
  const conflictCountByObject = new Map<string, number>();
  for (const conflict of conflicts) {
    conflictCountByObject.set(
      conflict.leftId,
      (conflictCountByObject.get(conflict.leftId) ?? 0) + 1,
    );
    conflictCountByObject.set(
      conflict.rightId,
      (conflictCountByObject.get(conflict.rightId) ?? 0) + 1,
    );
  }
  // Phase 2: derive per-node governance state from data already computed here. Only object-backed
  // nodes get it (hubs / me stay type-colored). usageCount comes from chunk citation telemetry
  // when the bundle builder supplies usageCountByObjectId (KB-space nodes).
  const objectByIdForGovernance = new Map(objects.map((object) => [object.id, object]));
  for (const node of nodes) {
    if (!node.objectId) {
      continue;
    }
    const object = objectByIdForGovernance.get(node.objectId);
    if (!object) {
      continue;
    }
    const conflictCount = conflictCountByObject.get(object.id) ?? 0;
    const freshness = object.freshnessStatus;
    const status: RelationshipNodeGovernanceStatus =
      conflictCount > 0
        ? "conflict"
        : freshness === "stale" || freshness === "expired"
          ? "attention"
          : "healthy";
    const usageCount = input.usageCountByObjectId?.[object.id];
    node.governance = {
      status,
      conflictCount,
      ...(freshness !== undefined ? { freshness } : {}),
      ...(usageCount != null && usageCount > 0 ? { usageCount } : {}),
    };
  }
  const enrichedObjects = objects.map((object) => ({
    ...object,
    relationshipSummary: summarizeObjectRelationships({
      objectId: object.id,
      graph,
      conflictCount: conflictCountByObject.get(object.id) ?? 0,
    }),
  }));

  return { graph, objects: enrichedObjects, conflicts };
}
