import type { KnowledgeGovernanceTask } from "../capability/knowledge-universe/endpoints.ts";

const TASK_TYPE_RANK: Record<KnowledgeGovernanceTask["taskType"], number> = {
  claim_conflict: 50,
  conflict: 40,
  stale: 30,
  duplicate: 20,
  orphan: 10,
};

/** Issue stream ordering: type severity, then server priority, then recency (design §11). */
export function sortGovernanceTasksForDisplay(
  tasks: KnowledgeGovernanceTask[],
): KnowledgeGovernanceTask[] {
  return [...tasks].toSorted((left, right) => {
    const typeDelta = TASK_TYPE_RANK[right.taskType] - TASK_TYPE_RANK[left.taskType];
    if (typeDelta !== 0) {
      return typeDelta;
    }
    const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
  });
}
