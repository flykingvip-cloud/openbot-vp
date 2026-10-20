import { describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import { setKnowledgeUniverseSelectedKnowledgeBase } from "./knowledge-universe-workspace.ts";
import { getKnowledgeUniverseRuntime } from "./knowledge-universe.ts";

function createState(overrides: Partial<AppPortState> = {}): AppPortState {
  return {
    requestUpdate: vi.fn(),
    client: null,
    connected: true,
    knowledgeUniversePageTab: "workbench",
    workbenchPrimaryModule: "knowledge",
    ...overrides,
  } as AppPortState;
}

describe("knowledge-universe library panorama on folder select", () => {
  it("sets knowledge-base home focus and reloads relationships with knowledgeBaseId", async () => {
    const client = {
      request: vi.fn(async (method: string, _params?: Record<string, unknown>) => {
        if (method === "knowledge.relationships") {
          return {
            graph: {
              nodes: [
                {
                  id: "node:obj:doc:ent-1",
                  kind: "knowledge-object",
                  title: "企业文档",
                  objectId: "obj:doc:ent-1",
                },
              ],
              edges: [],
            },
          };
        }
        if (method === "knowledge.search") {
          return {
            results: [],
            sourceSummary: { personal: 0, enterprise: 0, data: 0 },
            dataCapabilities: [],
            sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
            externalDataSources: [],
          };
        }
        if (method === "knowledge.recommendations") {
          return { recommendations: [] };
        }
        if (method === "knowledge.actions.list" || method === "knowledge.discovery.list") {
          return method === "knowledge.actions.list" ? { actions: [] } : { events: [] };
        }
        if (method === "knowledge.recent" || method === "knowledge.recent.record") {
          return { visits: [] };
        }
        if (method === "knowledge.base.list") {
          return { knowledgeBases: [] };
        }
        if (
          method.startsWith("knowledge.base.") ||
          method.startsWith("knowledge.governance.") ||
          method.startsWith("knowledge.deliverables.")
        ) {
          return {};
        }
        throw new Error(`unexpected method: ${method}`);
      }),
    };
    const state = createState({ client: client as never });
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.homeFocus = { kind: "document", id: "prev-doc", kbId: "kb-prev" };
    runtime.selectedNodeId = "node:obj:doc:prev-doc";

    setKnowledgeUniverseSelectedKnowledgeBase(state, "kb-enterprise-1");

    expect(runtime.homeFocus).toEqual({
      kind: "knowledge-base",
      id: "kb-enterprise-1",
      kbId: "kb-enterprise-1",
    });
    expect(runtime.selectedNodeId).toBeNull();

    await vi.waitFor(() => {
      expect(client.request).toHaveBeenCalledWith(
        "knowledge.relationships",
        expect.objectContaining({
          knowledgeBaseId: "kb-enterprise-1",
          focusDocumentId: null,
        }),
      );
    });
  });
});
