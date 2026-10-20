// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { KnowledgeGovernanceTask } from "../capability/knowledge-universe/endpoints.ts";
import { sortGovernanceTasksForDisplay } from "./knowledge-universe-governance-sort.ts";

function task(
  partial: Partial<KnowledgeGovernanceTask> & Pick<KnowledgeGovernanceTask, "id" | "taskType">,
): KnowledgeGovernanceTask {
  return {
    kbId: "kb",
    status: "open",
    priority: 0,
    relatedChunkIds: [],
    proposedResolution: null,
    assignedTo: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("sortGovernanceTasksForDisplay", () => {
  it("ranks claim conflicts above chunk conflicts and duplicates", () => {
    const sorted = sortGovernanceTasksForDisplay([
      task({ id: "dup", taskType: "duplicate", priority: 99 }),
      task({ id: "chunk", taskType: "conflict", priority: 10 }),
      task({ id: "claim", taskType: "claim_conflict", priority: 1 }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["claim", "chunk", "dup"]);
  });
});
