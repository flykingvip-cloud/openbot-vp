import { describe, expect, it } from "vitest";
import type { KnowledgeObject } from "../types.js";
import {
  buildCandidateRelationships,
  buildCandidateRelationshipsAsync,
} from "./relationship-builder.js";
import {
  detectRelationshipConflicts,
  detectRelationshipConflictsAsync,
} from "./relationship-conflict-detector.js";
import {
  buildIntelligentRelationshipGraph,
  buildIntelligentRelationshipGraphAsync,
  clearRelationshipRuntimeCache,
} from "./relationship-runtime.js";

function objectAt(index: number): KnowledgeObject {
  return {
    id: `obj:scale-${String(index).padStart(3, "0")}`,
    title: `object-${index}`,
    source: "personal",
    kind: "document",
    summary: `summary-${index}`,
    tags: ["知识库", index % 2 === 0 ? "alpha" : "beta"],
    updatedAt: 1_000 + index,
    scopeLabel: "个人知识库",
  };
}

describe("cooperative pairwise graph build", () => {
  const objects = Array.from({ length: 40 }, (_, index) => objectAt(index));

  it("async candidates and conflicts match the sync builders", async () => {
    const syncCandidates = buildCandidateRelationships({ objects });
    let candidateYields = 0;
    const asyncCandidates = await buildCandidateRelationshipsAsync(
      { objects },
      {
        yieldEvery: 10,
        yieldFn: async () => {
          candidateYields += 1;
        },
      },
    );
    expect(asyncCandidates).toEqual(syncCandidates);
    expect(candidateYields).toBeGreaterThan(0);

    const syncConflicts = detectRelationshipConflicts(objects);
    let conflictYields = 0;
    const asyncConflicts = await detectRelationshipConflictsAsync(objects, {
      yieldEvery: 10,
      yieldFn: async () => {
        conflictYields += 1;
      },
    });
    expect(asyncConflicts).toEqual(syncConflicts);
    expect(conflictYields).toBeGreaterThan(0);
  });

  it("async graph build matches the sync graph", async () => {
    clearRelationshipRuntimeCache();
    const sync = buildIntelligentRelationshipGraph({ objects });
    clearRelationshipRuntimeCache();
    const asyncResult = await buildIntelligentRelationshipGraphAsync(
      { objects },
      {
        yieldEvery: 10,
        yieldFn: async () => {},
      },
    );
    expect(asyncResult.graph).toEqual(sync.graph);
    expect(asyncResult.conflicts).toEqual(sync.conflicts);
  });
});
