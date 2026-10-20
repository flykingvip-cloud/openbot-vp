// Enterprise Data Capability Center — asset landscape graph aggregator.
// Spec: .kiro/specs/enterprise-data-capability-center/tasks.md (Task 3.1)
//
// Read-only four-layer graph: DataSource → DataCapability → Knowledge(projection) → Target.
// Edges:
//   - source   : DataSource → DataCapability   (capability.sourceIds)
//   - generate : DataCapability → Knowledge    (projection spec linked by capabilityId)
//   - open     : DataSource → Target            (DataAccessPolicy.sourceId → target)
//   - model    : DataSource → SemanticObject    (binding.sourceId; only if source node exists)
//   - serve    : SemanticObject → DataCapability (binding.capabilityId; only if capability included)
// SemanticObjects come from a SEPARATE store (SemanticObjectStore) and are passed in by the
// handler (tenant-filtered). When omitted, no object nodes/edges are added (backward compatible).
// Note: "open" is source-scoped because access policies are source-scoped in the model
// (policy.sourceId + targetKind/targetId), not capability-scoped.

import { listDataAccessPolicies } from "./data-access-policy-store.js";
import { listDataCapabilities } from "./data-capability-store.js";
import { listDataSources } from "./data-source-store.js";
import { listEnterpriseKnowledgeProjectionSpecs } from "./projection-spec-store.js";
import type { SemanticObject } from "./semantic-object-types.js";
import type { EnterpriseDataStore } from "./types.js";

export type AssetLandscapeNodeKind =
  | "source"
  | "capability"
  | "knowledge"
  | "object"
  | "department"
  | "seat"
  | "role";

// "model": DataSource → SemanticObject; "serve": SemanticObject → DataCapability.
export type AssetLandscapeEdgeRelation = "source" | "generate" | "open" | "model" | "serve";

export type AssetLandscapeNode = {
  id: string;
  kind: AssetLandscapeNodeKind;
  label: string;
};

export type AssetLandscapeEdge = {
  from: string;
  to: string;
  relation: AssetLandscapeEdgeRelation;
};

export type AssetLandscapeGraph = {
  nodes: AssetLandscapeNode[];
  edges: AssetLandscapeEdge[];
  /** True when capabilities were truncated by `limit` (graph is partial). */
  truncated: boolean;
};

const TARGET_KIND_NODE: Record<string, AssetLandscapeNodeKind> = {
  department: "department",
  seat: "seat",
  role: "role",
};

/**
 * Resolves a human-readable label for a target node, given its kind and raw targetId.
 * Falls back to the raw targetId when no authoritative label is available (e.g. department
 * has no first-class entity yet — see decision (a)).
 */
export type TargetLabelResolver = (kind: AssetLandscapeNodeKind, targetId: string) => string;

export function resolveAssetLandscapeGraph(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  /** Max capabilities included (bounds graph size). Default 50. */
  limit?: number;
  /** Optional human-label resolver for seat/role/department target nodes (P3 label quality). */
  targetLabelResolver?: TargetLabelResolver;
  /**
   * Optional semantic object catalog (from the separate SemanticObjectStore, tenant-filtered
   * by the caller). When omitted, no object nodes/edges are added (backward compatible).
   */
  semanticObjects?: SemanticObject[];
}): AssetLandscapeGraph {
  const { store, tenantId } = params;
  const limit = params.limit && params.limit > 0 ? params.limit : 50;
  const resolveLabel: TargetLabelResolver =
    params.targetLabelResolver ?? ((_kind, targetId) => targetId);

  const sources = listDataSources({ store, tenantId });
  const sourceById = new Map(sources.map((source) => [source.sourceId, source] as const));
  const allCapabilities = listDataCapabilities({ store, tenantId });
  const capabilities = allCapabilities.slice(0, limit);
  const includedCapabilityIds = new Set(capabilities.map((cap) => cap.capabilityId));

  const nodes = new Map<string, AssetLandscapeNode>();
  const edges: AssetLandscapeEdge[] = [];
  const edgeKeys = new Set<string>();

  function addNode(node: AssetLandscapeNode): void {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
  }
  function addEdge(edge: AssetLandscapeEdge): void {
    const key = `${edge.relation}:${edge.from}->${edge.to}`;
    if (!edgeKeys.has(key) && nodes.has(edge.from) && nodes.has(edge.to)) {
      edgeKeys.add(key);
      edges.push(edge);
    }
  }

  // Capability nodes + source→capability edges (only sources backing included capabilities).
  for (const capability of capabilities) {
    addNode({
      id: `capability:${capability.capabilityId}`,
      kind: "capability",
      label: capability.displayName,
    });
    for (const sourceId of capability.sourceIds) {
      const source = sourceById.get(sourceId);
      if (!source) {
        continue;
      }
      addNode({ id: `source:${source.sourceId}`, kind: "source", label: source.displayName });
      addEdge({
        from: `source:${source.sourceId}`,
        to: `capability:${capability.capabilityId}`,
        relation: "source",
      });
    }
  }

  // Knowledge nodes + capability→knowledge edges (projections linked to included capabilities).
  const projections = listEnterpriseKnowledgeProjectionSpecs({ store, tenantId });
  for (const projection of projections) {
    if (!projection.capabilityId || !includedCapabilityIds.has(projection.capabilityId)) {
      continue;
    }
    addNode({
      id: `knowledge:${projection.projectionId}`,
      kind: "knowledge",
      label: projection.displayName,
    });
    addEdge({
      from: `capability:${projection.capabilityId}`,
      to: `knowledge:${projection.projectionId}`,
      relation: "generate",
    });
  }

  // Target nodes + source→target "open" edges (source-scoped access policies).
  const policies = listDataAccessPolicies({ store, tenantId });
  for (const policy of policies) {
    if (!policy.sourceId) {
      continue;
    }
    const source = sourceById.get(policy.sourceId);
    if (!source) {
      continue;
    }
    const kind = TARGET_KIND_NODE[policy.targetKind];
    if (!kind) {
      continue;
    }
    // Ensure source node exists even if it backs no included capability.
    addNode({ id: `source:${source.sourceId}`, kind: "source", label: source.displayName });
    const targetNodeId = `${policy.targetKind}:${policy.targetId}`;
    addNode({ id: targetNodeId, kind, label: resolveLabel(kind, policy.targetId) });
    addEdge({ from: `source:${source.sourceId}`, to: targetNodeId, relation: "open" });
  }

  // Semantic object nodes + source→object (model) / object→capability (serve) edges.
  // addEdge only connects when both endpoints already exist, so a binding to a source
  // outside the value chain (or a non-included capability) yields no dangling edge.
  for (const object of params.semanticObjects ?? []) {
    if (object.tenantId !== tenantId) {
      continue;
    }
    const objectNodeId = `object:${object.objectId}`;
    addNode({ id: objectNodeId, kind: "object", label: object.displayName });
    for (const binding of object.sourceBindings) {
      addEdge({ from: `source:${binding.sourceId}`, to: objectNodeId, relation: "model" });
      if (binding.capabilityId) {
        addEdge({
          from: objectNodeId,
          to: `capability:${binding.capabilityId}`,
          relation: "serve",
        });
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    truncated: allCapabilities.length > capabilities.length,
  };
}
