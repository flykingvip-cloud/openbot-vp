import type { WorkspaceDeliverableDto } from "../capability/knowledge-universe/workspace-endpoints.ts";

/**
 * Agent memory taxonomy for the 「Agent 知识」 tab. These categories are DERIVED from
 * the real auto-captured deliverable fields (artifactKind / source / sourceType) — the
 * deliverables/成果 store IS the agent-generated-knowledge substrate, so we classify it
 * rather than maintain a redundant parallel table. A dedicated agent_generated_knowledge
 * model with first-class persisted types (long-term memory, auto-SOP, auto-discovered
 * relations) and its own generation pipeline remains the larger subsystem.
 */
export type AgentMemoryCategory =
  | "conversation"
  | "analysis"
  | "workflow"
  | "report"
  | "knowledge"
  | "collaboration"
  | "other";

const CATEGORY_ORDER: AgentMemoryCategory[] = [
  "conversation",
  "analysis",
  "workflow",
  "report",
  "knowledge",
  "collaboration",
  "other",
];

/**
 * Map a deliverable to an agent-memory category using only real fields. Canonical
 * artifactKind wins; otherwise we fall back to the capture source. No fabrication.
 */
export function classifyAgentMemoryCategory(
  deliverable: WorkspaceDeliverableDto,
): AgentMemoryCategory {
  switch (deliverable.artifactKind) {
    case "workflow_output":
      return "workflow";
    case "agent_result":
      return "analysis";
    case "report":
      return "report";
    case "knowledge":
    case "note":
      return "knowledge";
    default:
      break;
  }
  switch (deliverable.source) {
    case "chat":
      return "conversation";
    case "task":
      return "workflow";
    case "group":
      return "collaboration";
    default:
      break;
  }
  if (deliverable.sourceType === "collaboration") {
    return "collaboration";
  }
  if (deliverable.sourceType === "task") {
    return "workflow";
  }
  return "other";
}

export type AgentMemoryGroup = {
  category: AgentMemoryCategory;
  items: WorkspaceDeliverableDto[];
};

/**
 * Group agent deliverables into ordered, non-empty memory categories. Order follows the
 * memory taxonomy (conversation → analysis → workflow → report → knowledge → collaboration
 * → other) so the most "live" agent output surfaces first.
 */
export function summarizeAgentMemory(
  deliverables: readonly WorkspaceDeliverableDto[],
): AgentMemoryGroup[] {
  const buckets = new Map<AgentMemoryCategory, WorkspaceDeliverableDto[]>();
  for (const deliverable of deliverables) {
    const category = classifyAgentMemoryCategory(deliverable);
    const list = buckets.get(category);
    if (list) {
      list.push(deliverable);
    } else {
      buckets.set(category, [deliverable]);
    }
  }
  const groups: AgentMemoryGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const items = buckets.get(category);
    if (items && items.length > 0) {
      groups.push({ category, items });
    }
  }
  return groups;
}
