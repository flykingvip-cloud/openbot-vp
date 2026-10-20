/**
 * Phase 2 increment 4.4 — in-process Diagnosis Graph.
 * Validates relation kinds and RCA gates. Never invents causes from time order.
 * MODEL_INFERRED stays candidate. No production store or RPC.
 */
import {
  DiagnosisContractError,
  validateDiagnosisRelation,
  type DiagnosisRelation,
  type DiagnosisRelationKind,
  type DiagnosticFinding,
} from "./types.js";

export const GRAPH_RELATION_KINDS = [
  "derived_from",
  "correlated_with",
  "depends_on",
  "contributes_to",
  "causes",
] as const satisfies readonly DiagnosisRelationKind[];

export type GraphRelationKind = (typeof GRAPH_RELATION_KINDS)[number];

export const TEMPORAL_CAUSE_RULE_IDS = ["temporal_order", "time_order", "happened_before"] as const;

export type DiagnosisGraphNodeKind = "finding" | "evidence" | "observation";

export type DiagnosisGraphNode = {
  id: string;
  kind: DiagnosisGraphNodeKind;
};

export type DiagnosisGraph = {
  nodes: DiagnosisGraphNode[];
  edges: DiagnosisRelation[];
};

export function isGraphRelationKind(kind: string): kind is GraphRelationKind {
  return (GRAPH_RELATION_KINDS as readonly string[]).includes(kind);
}

export function isTemporalCauseRule(ruleId: string | undefined): boolean {
  return (
    typeof ruleId === "string" && (TEMPORAL_CAUSE_RULE_IDS as readonly string[]).includes(ruleId)
  );
}

export function assertGraphRelation(raw: unknown): DiagnosisRelation {
  const relation = validateDiagnosisRelation(raw);
  if (!isGraphRelationKind(relation.relation)) {
    throw new DiagnosisContractError(
      "graph_relation_kind",
      `Diagnosis Graph does not accept relation=${relation.relation}`,
      "relation",
    );
  }
  if (relation.relation === "causes" && isTemporalCauseRule(relation.ruleId)) {
    throw new DiagnosisContractError(
      "temporal_causes_forbidden",
      "causes must not be generated from temporal order alone",
      "ruleId",
    );
  }
  return relation;
}

export function assertNoParallelRca(input: {
  findings: readonly DiagnosticFinding[];
  relations: readonly DiagnosisRelation[];
}): void {
  const findingIds = new Set(input.findings.map((finding) => finding.findingId));
  const rcaTargets = input.relations
    .filter((relation) => relation.relation === "causes" && relation.state === "accepted")
    .map((relation) => relation.toId)
    .filter((toId) => findingIds.has(toId));
  if (new Set(rcaTargets).size > 1) {
    throw new DiagnosisContractError(
      "parallel_rca_forbidden",
      "cross-component Graph must not emit parallel accepted RCA findings",
      "relations",
    );
  }
}

export function buildDiagnosisGraph(input: {
  findings: readonly DiagnosticFinding[];
  evidenceIds: readonly string[];
  relations: readonly unknown[];
}): DiagnosisGraph {
  const edges = input.relations.map((relation) => assertGraphRelation(relation));
  const nodes = new Map<string, DiagnosisGraphNode>();
  for (const finding of input.findings) {
    nodes.set(finding.findingId, { id: finding.findingId, kind: "finding" });
  }
  for (const evidenceId of input.evidenceIds) {
    nodes.set(evidenceId, { id: evidenceId, kind: "evidence" });
  }
  for (const edge of edges) {
    if (!nodes.has(edge.fromId)) {
      nodes.set(edge.fromId, { id: edge.fromId, kind: "observation" });
    }
    if (!nodes.has(edge.toId)) {
      nodes.set(edge.toId, { id: edge.toId, kind: "observation" });
    }
  }
  return { nodes: [...nodes.values()], edges };
}

export function acceptedRootCauseRelations(
  relations: readonly DiagnosisRelation[],
): DiagnosisRelation[] {
  return relations.filter(
    (relation) => relation.relation === "causes" && relation.state === "accepted",
  );
}

export function candidateRootCauseRelations(
  relations: readonly DiagnosisRelation[],
): DiagnosisRelation[] {
  return relations.filter(
    (relation) => relation.relation === "causes" && relation.state === "candidate",
  );
}
