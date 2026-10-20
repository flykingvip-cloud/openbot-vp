import { describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import { runDeliverableGovernanceAction } from "./knowledge-universe-deliverable-actions.ts";
import { getKnowledgeUniverseRuntime } from "./knowledge-universe.ts";

function createState(overrides: Partial<AppPortState> = {}): AppPortState {
  return {
    requestUpdate: vi.fn(),
    client: {
      request: vi.fn(async (method: string) => {
        if (method === "knowledge.base.list") {
          return {
            knowledgeBases: [
              {
                id: "kb-1",
                title: "Library",
                description: "",
                documentCount: 2,
                visibility: "private",
                updatedAtMs: Date.now(),
              },
            ],
          };
        }
        if (method === "knowledge.deliverables.list") {
          return { deliverables: [] };
        }
        return {};
      }),
    },
    connected: true,
    knowledgeUniversePageTab: "deliverables",
    workbenchPrimaryModule: "knowledge",
    ...overrides,
  } as AppPortState;
}

describe("knowledge-universe deliverable governance actions", () => {
  it("opens deliverable detail focused on citations", async () => {
    const state = createState();
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.workspaceDeliverables = [
      {
        deliverableId: "del-1",
        title: "Demo",
        kind: "report",
        source: "chat",
        creators: ["main"],
        status: "draft",
        updatedAtMs: Date.now(),
      },
    ];

    await runDeliverableGovernanceAction(state, "del-1", "viewCitations");

    expect(state.knowledgeUniversePageTab).toBe("deliverableDetail");
    expect(runtime.deliverableDetailFocus).toBe("citations");
    expect(runtime.selectedWorkspaceSearchDeliverableId).toBe("del-1");
  });

  it("navigates to library when mergeKnowledge targets archived deliverable", async () => {
    const state = createState();
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.workspaceDeliverables = [
      {
        deliverableId: "del-2",
        title: "Archived",
        kind: "report",
        source: "chat",
        creators: ["main"],
        relatedKnowledgeBaseId: "kb-1",
        status: "published",
        updatedAtMs: Date.now(),
      },
    ];
    runtime.knowledgeBases = [
      {
        id: "kb-1",
        title: "Library",
        description: "",
        documentCount: 2,
        visibility: "private",
        updatedAtMs: Date.now(),
      },
    ];

    await runDeliverableGovernanceAction(state, "del-2", "mergeKnowledge");

    expect(state.knowledgeUniversePageTab).toBe("workbench");
    expect(runtime.selectedKnowledgeBaseId).toBe("kb-1");
  });
});
