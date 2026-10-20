import { describe, expect, it } from "vitest";
import {
  applyRefreshedTaskGapsToPending,
  pendingTaskGapsChanged,
  refreshPendingTaskGapViews,
} from "./pending-task-gap-sync.js";
import type { GrowthPendingTaskContext } from "./types.js";

function pending(overrides: Partial<GrowthPendingTaskContext> = {}): GrowthPendingTaskContext {
  return {
    draftText: "做市场分析",
    source: "composer",
    suggestedSkillKeys: ["crm", "market_research"],
    taskGaps: [
      { key: "crm", label: "CRM", kind: "skill", status: "missing" },
      { key: "market_research", label: "市场调研", kind: "skill", status: "missing" },
    ],
    extractedAtMs: 1,
    extractStatus: "ready",
    ...overrides,
  };
}

describe("pending task gap sync", () => {
  it("marks installed skills as satisfied on refresh", () => {
    const refreshed = refreshPendingTaskGapViews(pending(), ["crm"]);
    expect(refreshed).toEqual([
      expect.objectContaining({ key: "crm", status: "satisfied" }),
      expect.objectContaining({ key: "market_research", status: "missing" }),
    ]);
  });

  it("shrinks suggestedSkillKeys to remaining missing skills", () => {
    const next = applyRefreshedTaskGapsToPending(
      pending(),
      refreshPendingTaskGapViews(pending(), ["crm"]),
    );
    expect(next.suggestedSkillKeys).toEqual(["market_research"]);
    expect(next.taskGaps.find((gap) => gap.key === "crm")?.status).toBe("satisfied");
  });

  it("detects persisted gap status changes", () => {
    const before = pending();
    const after = applyRefreshedTaskGapsToPending(
      before,
      refreshPendingTaskGapViews(before, ["crm", "market_research"]),
    );
    expect(pendingTaskGapsChanged(before, after)).toBe(true);
    expect(pendingTaskGapsChanged(after, after)).toBe(false);
  });

  it("treats a missing suggestedSkillKeys list as empty and falls back to task gaps", () => {
    const stored = pending({
      suggestedSkillKeys: undefined as unknown as string[],
      taskGaps: [
        null as unknown as GrowthPendingTaskContext["taskGaps"][number],
        { key: "crm", label: "CRM", kind: "skill", status: "missing" },
      ],
    });

    const refreshed = refreshPendingTaskGapViews(stored, []);

    expect(refreshed.map((gap) => gap.key)).toEqual(["crm"]);
    const next = applyRefreshedTaskGapsToPending(stored, refreshed);
    expect(next.suggestedSkillKeys).toEqual(["crm"]);
    expect(() => pendingTaskGapsChanged(pending(), stored)).not.toThrow();
    expect(pendingTaskGapsChanged(pending(), stored)).toBe(true);
  });

  it("unblocks growth gate after all task skills installed", () => {
    const next = applyRefreshedTaskGapsToPending(
      pending(),
      refreshPendingTaskGapViews(pending(), ["crm", "market_research"]),
    );
    expect(next.taskGaps.every((gap) => gap.status === "satisfied")).toBe(true);
    expect(next.suggestedSkillKeys).toEqual([]);
  });
});
