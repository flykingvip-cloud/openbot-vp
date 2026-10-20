import { describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import {
  getKnowledgeUniverseRuntime,
  setKnowledgeUniverseHomeFocus,
} from "./knowledge-universe.ts";

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

describe("knowledge-universe home focus document ego", () => {
  it("switches to the focused document ego graph when selecting library docs", async () => {
    const client = {
      request: vi.fn(async (method: string, params?: Record<string, unknown>) => {
        if (method === "knowledge.relationships") {
          const focusRaw = params?.focusDocumentId;
          const focusDocumentId = typeof focusRaw === "string" ? focusRaw : "";
          const objectId = `obj:doc:${focusDocumentId}`;
          return {
            graph: {
              nodes: [
                {
                  id: `node:${objectId}`,
                  kind: "knowledge-object",
                  title: focusDocumentId === "doc-b" ? "文档 B" : "文档 A",
                  objectId,
                  summary: "暂无跨文档关系",
                },
              ],
              edges: [],
            },
          };
        }
        if (method === "knowledge.object") {
          const nodeRaw = params?.nodeId;
          const nodeId = typeof nodeRaw === "string" ? nodeRaw : "";
          const objectId = nodeId.replace(/^node:/, "");
          return {
            object: {
              id: objectId,
              title: objectId.includes("doc-b") ? "文档 B" : "文档 A",
              source: "personal",
              kind: "document",
              summary: "",
              tags: [],
              updatedAt: Date.now(),
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
        if (method === "knowledge.related") {
          return {
            object: null,
            knowledge: [],
            dataCapabilities: [],
            agents: [],
            owners: [],
            conflicts: [],
            graph: { nodes: [], edges: [] },
          };
        }
        if (method === "knowledge.recent" || method === "knowledge.recent.record") {
          return { visits: [] };
        }
        if (method === "knowledge.recommendations") {
          return { recommendations: [] };
        }
        if (method === "knowledge.actions.list" || method === "knowledge.discovery.list") {
          return method === "knowledge.actions.list" ? { actions: [] } : { events: [] };
        }
        if (method === "knowledge.personal.versions") {
          return { versions: [] };
        }
        throw new Error(`unexpected method: ${method}`);
      }),
    };
    const state = createState({ client: client as never });
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.selectedKnowledgeBaseId = "kb-1";
    runtime.graph = {
      nodes: [
        {
          id: "node:obj:kb:kb-1",
          kind: "knowledge-base",
          title: "库",
          objectId: "obj:kb:kb-1",
        },
      ],
      edges: [],
    };

    setKnowledgeUniverseHomeFocus(state, {
      kind: "document",
      id: "doc-a",
      kbId: "kb-1",
    });
    await vi.waitFor(() => {
      expect(runtime.selectedNodeId).toBe("node:obj:doc:doc-a");
      expect(runtime.graph?.nodes.some((node) => node.id === "node:obj:doc:doc-a")).toBe(true);
      expect(runtime.graph?.nodes.some((node) => node.kind === "knowledge-base")).toBe(false);
    });

    setKnowledgeUniverseHomeFocus(state, {
      kind: "document",
      id: "doc-b",
      kbId: "kb-1",
    });
    await vi.waitFor(() => {
      expect(runtime.selectedNodeId).toBe("node:obj:doc:doc-b");
      expect(runtime.selectedObject?.id).toBe("obj:doc:doc-b");
      expect(runtime.selectedObject?.title).toBe("文档 B");
      // Document focus returns ego topology only — previous doc / KB folders drop out.
      expect(runtime.graph?.nodes.some((node) => node.id === "node:obj:doc:doc-a")).toBe(false);
      expect(runtime.graph?.nodes.some((node) => node.id === "node:obj:doc:doc-b")).toBe(true);
      expect(runtime.graph?.nodes.some((node) => node.kind === "knowledge-base")).toBe(false);
    });

    expect(client.request).toHaveBeenCalledWith(
      "knowledge.relationships",
      expect.objectContaining({
        focusDocumentId: "doc-b",
        knowledgeBaseId: "kb-1",
      }),
    );
  });

  it("does not synthesize selectedObject from the first KB node when focus doc is missing", async () => {
    const client = {
      request: vi.fn(async (method: string, _params?: Record<string, unknown>) => {
        if (method === "knowledge.relationships") {
          return {
            graph: {
              nodes: [
                {
                  id: "node:obj:kb:kb-1",
                  kind: "knowledge-base",
                  title: "波司登错位诱饵",
                  objectId: "obj:kb:kb-1",
                },
              ],
              edges: [],
            },
          };
        }
        if (method === "knowledge.object") {
          return { object: null };
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
        if (method === "knowledge.recent" || method === "knowledge.recent.record") {
          return { visits: [] };
        }
        if (method === "knowledge.recommendations") {
          return { recommendations: [] };
        }
        if (method === "knowledge.actions.list" || method === "knowledge.discovery.list") {
          return method === "knowledge.actions.list" ? { actions: [] } : { events: [] };
        }
        if (method === "knowledge.related") {
          return {
            object: null,
            knowledge: [],
            dataCapabilities: [],
            agents: [],
            owners: [],
            conflicts: [],
            graph: { nodes: [], edges: [] },
          };
        }
        if (method === "knowledge.personal.versions") {
          return { versions: [] };
        }
        throw new Error(`unexpected method: ${method}`);
      }),
    };
    const state = createState({ client: client as never });
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.selectedKnowledgeBaseId = "kb-1";

    setKnowledgeUniverseHomeFocus(state, {
      kind: "document",
      id: "doc-missing",
      kbId: "kb-1",
    });
    await vi.waitFor(() => {
      expect(runtime.selectedNodeId).toBe("node:obj:doc:doc-missing");
      expect(runtime.graph?.nodes.some((node) => node.id === "node:obj:kb:kb-1")).toBe(true);
    });
    expect(runtime.selectedObject?.title).not.toBe("波司登错位诱饵");
  });
});
