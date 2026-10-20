import { describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import {
  setKnowledgeUniverseNewKnowledgeBaseDescription,
  setKnowledgeUniverseNewKnowledgeBaseTitle,
} from "./knowledge-universe-workspace.ts";
import { getKnowledgeUniverseRuntime, setKnowledgeUniversePageTab } from "./knowledge-universe.ts";

function createState(overrides: Partial<AppPortState> = {}): AppPortState {
  return {
    requestUpdate: vi.fn(),
    connected: true,
    workbenchPrimaryModule: "assistant",
    knowledgeUniversePageTab: "workbench",
    ...overrides,
  } as AppPortState;
}

describe("knowledge-universe library create page tab", () => {
  it("opens libraryCreate without locking the form behind workspaceBusy", async () => {
    const client = {
      request: vi.fn(() => new Promise(() => {})),
    };
    const state = createState({ client: client as never });
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.workspaceBusy = false;

    setKnowledgeUniversePageTab(state, "libraryCreate");
    await Promise.resolve();

    expect(state.knowledgeUniversePageTab).toBe("libraryCreate");
    expect(state.workbenchPrimaryModule).toBe("knowledge");
    expect(runtime.workspaceBusy).toBe(false);
    expect(runtime.workspaceDeliverablesExpanded).toBe(false);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("still loads workspace when remapping the legacy deliverables tab", async () => {
    // A bare `let` narrowed to null makes the later optional call untypeable.
    // The resolver is assigned inside the request mock, so keep it on a box.
    const pending: {
      resolveList: ((value: { knowledgeBases: unknown[] }) => void) | null;
    } = { resolveList: null };
    const client = {
      request: vi.fn((method: string) => {
        if (method === "knowledge.base.list") {
          return new Promise<{ knowledgeBases: unknown[] }>((resolve) => {
            pending.resolveList = resolve;
          });
        }
        if (method === "knowledge.deliverables.list") {
          return Promise.resolve({ deliverables: [] });
        }
        return Promise.resolve({});
      }),
    };
    const state = createState({ client: client as never });
    const runtime = getKnowledgeUniverseRuntime(state);

    setKnowledgeUniversePageTab(state, "deliverables");
    await Promise.resolve();

    expect(state.knowledgeUniversePageTab).toBe("workbench");
    expect(runtime.workspaceBusy).toBe(true);
    expect(runtime.workspaceDeliverablesExpanded).toBe(true);
    expect(client.request.mock.calls.some((call) => call[0] === "knowledge.base.list")).toBe(true);

    pending.resolveList?.({ knowledgeBases: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.workspaceBusy).toBe(false);
  });

  it("retains typed create-space title and description in runtime state", () => {
    const state = createState();
    setKnowledgeUniverseNewKnowledgeBaseTitle(state, "合规知识库");
    setKnowledgeUniverseNewKnowledgeBaseDescription(state, "制度与流程");
    const runtime = getKnowledgeUniverseRuntime(state);
    expect(runtime.newKnowledgeBaseTitle).toBe("合规知识库");
    expect(runtime.newKnowledgeBaseDescription).toBe("制度与流程");
    expect(state.knowledgeUniverseNewKnowledgeBaseTitle).toBe("合规知识库");
    expect(state.knowledgeUniverseNewKnowledgeBaseDescription).toBe("制度与流程");
  });
});
