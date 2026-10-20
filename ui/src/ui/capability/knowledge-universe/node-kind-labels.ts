import { t } from "../../../i18n/index.ts";
import type {
  GraphViewNodeCategory,
  RelationshipEdgeType,
  RelationshipNodeGovernanceStatus,
  RelationshipNodeKind,
} from "./types.ts";

const CATEGORY_LABEL_KEY: Record<GraphViewNodeCategory, string> = {
  knowledge: "knowledge",
  "knowledge-base": "knowledgeBase",
  deliverable: "deliverable",
  data: "dataCapability",
  agent: "agent",
  project: "project",
  owner: "owner",
};

/** Legend label for a graph node category (what a colored node represents). */
export function graphCategoryLabel(category: GraphViewNodeCategory): string {
  const key = CATEGORY_LABEL_KEY[category] ?? "knowledge";
  return t(`frontstage.workbench.knowledgeUniverse.nodeKinds.${key}`);
}

/** Label for a node governance status (health signal overlaid on the type color). */
export function graphGovernanceStatusLabel(status: RelationshipNodeGovernanceStatus): string {
  return t(`frontstage.workbench.knowledgeUniverse.governanceStatus.${status}`);
}

export function relationshipNodeKindLabel(kind: RelationshipNodeKind): string {
  switch (kind) {
    case "knowledge-object":
      return t("frontstage.workbench.knowledgeUniverse.nodeKinds.knowledge");
    case "knowledge-base":
      return t("frontstage.workbench.knowledgeUniverse.nodeKinds.knowledgeBase");
    case "deliverable":
      return t("frontstage.workbench.knowledgeUniverse.nodeKinds.deliverable");
    case "data-capability":
      return t("frontstage.workbench.knowledgeUniverse.nodeKinds.dataCapability");
    case "agent":
      return t("frontstage.workbench.knowledgeUniverse.nodeKinds.agent");
    case "project":
      return t("frontstage.workbench.knowledgeUniverse.nodeKinds.project");
    case "owner":
      return t("frontstage.workbench.knowledgeUniverse.nodeKinds.owner");
    default:
      return t("frontstage.workbench.knowledgeUniverse.nodeKinds.knowledge");
  }
}

const EDGE_TYPE_LABEL_KEY: Record<RelationshipEdgeType, string> = {
  related: "related",
  supports: "supports",
  conflicts: "conflicts",
  "derived-from": "derivedFrom",
  "archived-into": "archivedInto",
  "owned-by": "ownedBy",
  "used-by": "usedBy",
  "recommended-for": "recommendedFor",
};

/** Human-readable label for a relationship edge type (why two nodes are connected). */
export function relationshipEdgeTypeLabel(type: RelationshipEdgeType): string {
  const key = EDGE_TYPE_LABEL_KEY[type] ?? "related";
  return t(`frontstage.workbench.knowledgeUniverse.relationTypes.${key}`);
}

export function resolveNodeIdForObject(
  graph: { nodes: Array<{ id: string; objectId?: string }> } | null,
  objectId: string,
): string | null {
  return graph?.nodes.find((node) => node.objectId === objectId)?.id ?? null;
}
