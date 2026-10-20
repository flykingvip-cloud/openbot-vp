import { describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import { applyDiscoveryEventNavigation } from "./knowledge-universe-discovery.ts";

function stateStub(overrides: Partial<AppPortState> = {}): AppPortState {
  return {
    knowledgeUniversePageTab: "workbench",
    knowledgeUniverseSelectedWorkspaceSearchDeliverableId: null,
    requestUpdate: vi.fn(),
    ...overrides,
  } as AppPortState;
}

vi.mock("./knowledge-universe-action-runner.ts", () => ({
  runKnowledgeActionSuggestion: vi.fn(async () => undefined),
}));

vi.mock("./knowledge-universe-deliverable-actions.ts", () => ({
  setKnowledgeUniverseDeliverableDetailFocus: vi.fn(),
}));

vi.mock("./knowledge-universe-workspace.ts", () => ({
  loadKnowledgeUniverseDeliverableTrace: vi.fn(async () => undefined),
  loadKnowledgeUniverseWorkspace: vi.fn(async () => undefined),
  setKnowledgeUniverseSelectedKnowledgeBase: vi.fn(),
}));

vi.mock("./knowledge-universe.ts", () => ({
  loadKnowledgeUniverseGovernance: vi.fn(async () => undefined),
  setKnowledgeUniversePageTab: vi.fn(),
}));

describe("applyDiscoveryEventNavigation", () => {
  it("opens the home cockpit for lineage events instead of governance", async () => {
    const { setKnowledgeUniversePageTab } = await import("./knowledge-universe.ts");
    const { setKnowledgeUniverseSelectedKnowledgeBase } =
      await import("./knowledge-universe-workspace.ts");
    const state = stateStub();
    await applyDiscoveryEventNavigation(state, {
      eventId: "lineage:1",
      eventType: "knowledge_committed",
      eventSource: "lineage",
      title: "committed",
      summary: "summary",
      timestamp: Date.now(),
      relatedKnowledge: { kbId: "kb-1", deliverableId: "del-1" },
    });
    expect(setKnowledgeUniverseSelectedKnowledgeBase).toHaveBeenCalledWith(state, "kb-1");
    expect(setKnowledgeUniversePageTab).toHaveBeenCalledWith(state, "workbench");
  });
});
