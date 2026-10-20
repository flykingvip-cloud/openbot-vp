import { describe, expect, it, vi } from "vitest";
import type { KnowledgeDiscoveryEvent } from "../capability/knowledge-universe/types.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  enterKnowledgeUniverseDiscovery,
  resolveDiscoveryEventDestination,
} from "./knowledge-universe-discovery-nav.ts";

function event(
  overrides: Partial<KnowledgeDiscoveryEvent> &
    Pick<KnowledgeDiscoveryEvent, "eventId" | "eventType" | "eventSource">,
): KnowledgeDiscoveryEvent {
  return {
    title: "t",
    summary: "s",
    timestamp: Date.now(),
    relatedKnowledge: {},
    ...overrides,
  };
}

describe("resolveDiscoveryEventDestination", () => {
  it("routes governance tasks to the governance center", () => {
    expect(
      resolveDiscoveryEventDestination(
        event({
          eventId: "e1",
          eventType: "new_duplicate",
          eventSource: "governance",
          relatedKnowledge: { kbId: "kb-1", governanceTaskId: "task-1" },
        }),
      ),
    ).toEqual({
      kind: "governance",
      kbId: "kb-1",
      governanceTaskId: "task-1",
      actionType: "merge_duplicate",
    });
  });

  it("routes lineage commits to the home cockpit", () => {
    expect(
      resolveDiscoveryEventDestination(
        event({
          eventId: "e2",
          eventType: "knowledge_committed",
          eventSource: "lineage",
          relatedKnowledge: { kbId: "kb-1", deliverableId: "del-1" },
        }),
      ),
    ).toEqual({ kind: "workbench", kbId: "kb-1" });
  });

  it("routes new relations to the home cockpit", () => {
    expect(
      resolveDiscoveryEventDestination(
        event({
          eventId: "e3",
          eventType: "new_relation",
          eventSource: "relation",
          relatedKnowledge: { kbId: "kb-1", relationType: "reference" },
        }),
      ),
    ).toEqual({ kind: "workbench", kbId: "kb-1" });
  });

  it("routes conflict relations to governance", () => {
    expect(
      resolveDiscoveryEventDestination(
        event({
          eventId: "e4",
          eventType: "new_relation",
          eventSource: "relation",
          relatedKnowledge: { kbId: "kb-1", relationType: "conflict" },
        }),
      ),
    ).toEqual({ kind: "governance", kbId: "kb-1", actionType: "open_governance" });
  });

  it("routes deliverable completion to deliverable detail", () => {
    expect(
      resolveDiscoveryEventDestination(
        event({
          eventId: "e5",
          eventType: "deliverable_completed",
          eventSource: "deliverable",
          relatedKnowledge: { deliverableId: "del-9" },
        }),
      ),
    ).toEqual({ kind: "deliverableDetail", deliverableId: "del-9", kbId: undefined });
  });
});

describe("enterKnowledgeUniverseDiscovery", () => {
  it("opens the home cockpit when a space exists", () => {
    const onPageTabChange = vi.fn();
    const onSelectKnowledgeBase = vi.fn();
    enterKnowledgeUniverseDiscovery({
      knowledgeBases: [{ id: "kb-1" }],
      selectedKnowledgeBaseId: "kb-1",
      onSelectKnowledgeBase,
      onPageTabChange,
    } as unknown as WorkbenchKnowledgeSurface);
    expect(onPageTabChange).toHaveBeenCalledWith("workbench");
    expect(onSelectKnowledgeBase).not.toHaveBeenCalled();
  });

  it("selects the first space before opening when none is selected", () => {
    const onPageTabChange = vi.fn();
    const onSelectKnowledgeBase = vi.fn();
    enterKnowledgeUniverseDiscovery({
      knowledgeBases: [{ id: "kb-1" }, { id: "kb-2" }],
      selectedKnowledgeBaseId: null,
      onSelectKnowledgeBase,
      onPageTabChange,
    } as unknown as WorkbenchKnowledgeSurface);
    expect(onSelectKnowledgeBase).toHaveBeenCalledWith("kb-1");
    expect(onPageTabChange).toHaveBeenCalledWith("workbench");
  });

  it("opens create page when no spaces exist", () => {
    const onPageTabChange = vi.fn();
    enterKnowledgeUniverseDiscovery({
      knowledgeBases: [],
      selectedKnowledgeBaseId: null,
      onPageTabChange,
    } as unknown as WorkbenchKnowledgeSurface);
    expect(onPageTabChange).toHaveBeenCalledWith("libraryCreate");
  });
});
