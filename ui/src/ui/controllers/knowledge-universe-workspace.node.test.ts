import { describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import {
  createKnowledgeUniverseFolderInSection,
  deleteLibraryWorkspaceDocument,
  unbindLibraryWorkspaceSource,
} from "./knowledge-universe-workspace.ts";
import { getKnowledgeUniverseRuntime } from "./knowledge-universe.ts";

function createState(overrides: Partial<AppPortState> = {}): AppPortState {
  return {
    requestUpdate: vi.fn(),
    connected: true,
    workbenchPrimaryModule: "knowledge",
    knowledgeUniversePageTab: "workbench",
    ...overrides,
  } as AppPortState;
}

function emptySourceSummary() {
  return {
    personal: { documentCount: 0, recentUpdates: 0 },
    enterprise: { libraryCount: 0, accessibleCount: 0 },
    data: { grantedCount: 0, requestableCount: 0, externalSourceCount: 0 },
  };
}

describe("knowledge-universe workspace delete", () => {
  it("optimistically removes a source row before the delete rpc resolves", async () => {
    let resolveDelete: (() => void) | null = null;
    const client = {
      request: vi.fn((method: string, params?: Record<string, unknown>) => {
        if (method === "knowledge.base.documents.delete") {
          return new Promise((resolve) => {
            resolveDelete = () =>
              resolve({
                knowledgeBase: {
                  id: "kb-1",
                  title: "Library",
                  description: "",
                  documentCount: 0,
                  visibility: "private",
                  updatedAtMs: Date.now(),
                  ownerId: "user-a",
                  documentIds: [],
                },
                documentId: params?.documentId,
              });
          });
        }
        if (method === "knowledge.base.list") {
          return Promise.resolve({
            knowledgeBases: [
              {
                id: "kb-1",
                title: "Library",
                description: "",
                documentCount: 0,
                visibility: "private",
                updatedAtMs: Date.now(),
              },
            ],
          });
        }
        if (method === "knowledge.deliverables.list") {
          return Promise.resolve({ deliverables: [] });
        }
        if (method === "knowledge.base.sources.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", sources: [] });
        }
        if (method === "knowledge.base.snippets.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", snippets: [] });
        }
        if (method === "knowledge.base.members.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", members: [] });
        }
        if (method === "knowledge.base.documents.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", documents: [] });
        }
        if (method === "knowledge.search") {
          return Promise.resolve({
            results: [],
            evidence: [],
            searchMode: "substring",
            sourceSummary: emptySourceSummary(),
            dataCapabilities: [],
            sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
            externalDataSources: [],
          });
        }
        if (method === "knowledge.relationships") {
          return Promise.resolve({ graph: { nodes: [], edges: [] } });
        }
        if (method === "knowledge.recommendations") {
          return Promise.resolve({ recommendations: [] });
        }
        if (method === "knowledge.discovery.list") {
          return Promise.resolve({ events: [] });
        }
        if (method === "knowledge.actions.list") {
          return Promise.resolve({ actions: [] });
        }
        if (method === "knowledge.recent") {
          return Promise.resolve({ visits: [] });
        }
        if (method === "knowledge.governance.summary") {
          return Promise.resolve({
            summary: {
              openConflictCount: 0,
              openClaimConflictCount: 0,
              openDuplicateCount: 0,
              openStaleCount: 0,
              openOrphanCount: 0,
              suppressedChunkCount: 0,
              confirmedChunkCount: 0,
            },
          });
        }
        if (method === "knowledge.governance.tasks.list") {
          return Promise.resolve({ tasks: [] });
        }
        throw new Error(`unexpected method: ${method}`);
      }),
    };
    const state = createState({ client: client as never });
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.selectedKnowledgeBaseId = "kb-1";
    runtime.knowledgeBases = [
      {
        id: "kb-1",
        title: "Library",
        description: "",
        documentCount: 1,
        visibility: "private",
        updatedAtMs: Date.now(),
      },
    ];
    runtime.libraryWorkspaceSources = [
      {
        id: "doc:doc-1",
        knowledgeBaseId: "kb-1",
        plane: "passive",
        kind: "document",
        title: "Runbook",
        documentId: "doc-1",
        updatedAtMs: Date.now(),
        visibility: "private",
      },
    ];
    runtime.libraryWorkspaceDocuments = [
      {
        docId: "doc-1",
        title: "Runbook",
        contentType: "text/markdown",
        updatedAtMs: Date.now(),
        indexed: true,
      },
    ];

    const pending = deleteLibraryWorkspaceDocument(state, "doc-1");

    expect(runtime.workspaceBusy).toBe(true);
    expect(runtime.libraryWorkspaceSources).toEqual([]);
    expect(runtime.libraryWorkspaceDocuments).toEqual([]);
    expect(runtime.knowledgeBases[0]?.documentCount).toBe(0);

    const finishDelete = resolveDelete as (() => void) | null;
    if (!finishDelete) {
      throw new Error("expected delete rpc to be pending");
    }
    finishDelete();
    await pending;

    expect(client.request).toHaveBeenCalledWith("knowledge.base.documents.delete", {
      knowledgeBaseId: "kb-1",
      documentId: "doc-1",
    });
    expect(runtime.workspaceError).toBeNull();
    expect(runtime.libraryWorkspaceSources).toEqual([]);
  });

  it("removes cloudDrive rows via knowledge.source.unbind even when connector purge is unavailable", async () => {
    const client = {
      request: vi.fn((method: string) => {
        if (method === "knowledge.connector.unbind") {
          return Promise.reject(new Error("unknown method: knowledge.connector.unbind"));
        }
        if (method === "knowledge.source.unbind") {
          return Promise.resolve({ ok: true });
        }
        if (method === "knowledge.base.sources.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", sources: [] });
        }
        if (method === "knowledge.base.snippets.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", snippets: [] });
        }
        if (method === "knowledge.base.members.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", members: [] });
        }
        if (method === "knowledge.base.documents.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", documents: [] });
        }
        if (method === "knowledge.search") {
          return Promise.resolve({
            results: [],
            evidence: [],
            searchMode: "substring",
            sourceSummary: emptySourceSummary(),
            dataCapabilities: [],
            sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
            externalDataSources: [],
          });
        }
        if (method === "knowledge.relationships") {
          return Promise.resolve({ graph: { nodes: [], edges: [] } });
        }
        if (method === "knowledge.recommendations") {
          return Promise.resolve({ recommendations: [] });
        }
        if (method === "knowledge.discovery.list") {
          return Promise.resolve({ events: [] });
        }
        if (method === "knowledge.actions.list") {
          return Promise.resolve({ actions: [] });
        }
        if (method === "knowledge.recent") {
          return Promise.resolve({ visits: [] });
        }
        if (method === "knowledge.governance.summary") {
          return Promise.resolve({
            summary: {
              openConflictCount: 0,
              openClaimConflictCount: 0,
              openDuplicateCount: 0,
              openStaleCount: 0,
              openOrphanCount: 0,
              suppressedChunkCount: 0,
              confirmedChunkCount: 0,
            },
          });
        }
        if (method === "knowledge.governance.tasks.list") {
          return Promise.resolve({ tasks: [] });
        }
        return Promise.resolve({});
      }),
    };
    const state = createState({ client: client as never });
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.selectedKnowledgeBaseId = "kb-1";
    runtime.libraryWorkspaceSources = [
      {
        id: "binding:src-cloud",
        knowledgeBaseId: "kb-1",
        plane: "passive",
        kind: "cloudDrive",
        title: "阿里云盘",
        status: "unknown",
        sourceDescriptorId: "src-cloud",
        updatedAtMs: Date.now(),
        visibility: "private",
      },
    ];

    await unbindLibraryWorkspaceSource(state, {
      id: "binding:src-cloud",
      kind: "cloudDrive",
      sourceDescriptorId: "src-cloud",
    });

    expect(client.request).toHaveBeenCalledWith("knowledge.source.unbind", { id: "src-cloud" });
    expect(runtime.workspaceError).toBeNull();
    expect(runtime.libraryWorkspaceSources).toEqual([]);
  });

  it("removes localFolder rows via knowledge.source.unbind even if dedicated unbind returns ok:false", async () => {
    const client = {
      request: vi.fn((method: string) => {
        if (method === "knowledge.local-folder.unbind") {
          return Promise.resolve({ ok: false });
        }
        if (method === "knowledge.source.unbind") {
          return Promise.resolve({ ok: true });
        }
        if (method === "knowledge.base.sources.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", sources: [] });
        }
        if (method === "knowledge.base.snippets.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", snippets: [] });
        }
        if (method === "knowledge.base.members.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", members: [] });
        }
        if (method === "knowledge.base.documents.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-1", documents: [] });
        }
        if (method === "knowledge.search") {
          return Promise.resolve({
            results: [],
            evidence: [],
            searchMode: "substring",
            sourceSummary: emptySourceSummary(),
            dataCapabilities: [],
            sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
            externalDataSources: [],
          });
        }
        if (method === "knowledge.relationships") {
          return Promise.resolve({ graph: { nodes: [], edges: [] } });
        }
        if (method === "knowledge.recommendations") {
          return Promise.resolve({ recommendations: [] });
        }
        if (method === "knowledge.discovery.list") {
          return Promise.resolve({ events: [] });
        }
        if (method === "knowledge.actions.list") {
          return Promise.resolve({ actions: [] });
        }
        if (method === "knowledge.recent") {
          return Promise.resolve({ visits: [] });
        }
        if (method === "knowledge.governance.summary") {
          return Promise.resolve({
            summary: {
              openConflictCount: 0,
              openClaimConflictCount: 0,
              openDuplicateCount: 0,
              openStaleCount: 0,
              openOrphanCount: 0,
              suppressedChunkCount: 0,
              confirmedChunkCount: 0,
            },
          });
        }
        if (method === "knowledge.governance.tasks.list") {
          return Promise.resolve({ tasks: [] });
        }
        return Promise.resolve({});
      }),
    };
    const state = createState({ client: client as never });
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.selectedKnowledgeBaseId = "kb-1";
    runtime.libraryWorkspaceSources = [
      {
        id: "binding:src-folder",
        knowledgeBaseId: "kb-1",
        plane: "passive",
        kind: "localFolder",
        title: "学习材料",
        status: "unknown",
        sourceDescriptorId: "src-folder",
        updatedAtMs: Date.now(),
        visibility: "private",
      },
    ];

    await unbindLibraryWorkspaceSource(state, {
      id: "binding:src-folder",
      kind: "localFolder",
      sourceDescriptorId: "src-folder",
    });

    expect(client.request).toHaveBeenCalledWith("knowledge.source.unbind", { id: "src-folder" });
    expect(runtime.workspaceError).toBeNull();
    expect(runtime.libraryWorkspaceSources).toEqual([]);
  });
});

describe("knowledge-universe section folder create", () => {
  it("creates a folder via RPC and enters inline rename without libraryCreate tab hop", async () => {
    const client = {
      request: vi.fn((method: string) => {
        if (method === "knowledge.base.create") {
          return Promise.resolve({
            knowledgeBase: {
              id: "kb-new",
              title: "我的知识空间",
              description: "",
              documentCount: 0,
              visibility: "private",
              updatedAtMs: Date.now(),
              ownerId: "user-a",
              documentIds: [],
            },
          });
        }
        if (method === "knowledge.base.list") {
          return Promise.resolve({
            knowledgeBases: [
              {
                id: "kb-new",
                title: "我的知识空间",
                description: "",
                documentCount: 0,
                visibility: "private",
                updatedAtMs: Date.now(),
              },
            ],
          });
        }
        if (method === "knowledge.base.sources.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-new", sources: [] });
        }
        if (method === "knowledge.base.snippets.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-new", snippets: [] });
        }
        if (method === "knowledge.base.members.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-new", members: [] });
        }
        if (method === "knowledge.search") {
          return Promise.resolve({
            results: [],
            evidence: [],
            searchMode: "substring",
            sourceSummary: emptySourceSummary(),
            dataCapabilities: [],
            sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
            externalDataSources: [],
          });
        }
        if (method === "knowledge.relationships") {
          return Promise.resolve({ graph: { nodes: [], edges: [] } });
        }
        if (method === "knowledge.recommendations") {
          return Promise.resolve({ recommendations: [] });
        }
        if (method === "knowledge.discovery.list") {
          return Promise.resolve({ events: [] });
        }
        if (method === "knowledge.actions.list") {
          return Promise.resolve({ actions: [] });
        }
        if (method === "knowledge.recent") {
          return Promise.resolve({ visits: [] });
        }
        if (method === "knowledge.base.documents.list") {
          return Promise.resolve({ knowledgeBaseId: "kb-new", documents: [] });
        }
        return Promise.resolve({});
      }),
    };
    const state = createState({
      client: client as unknown as AppPortState["client"],
      knowledgeUniversePageTab: "workbench",
    });
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.knowledgeBases = [];

    await createKnowledgeUniverseFolderInSection(state, "private");

    expect(client.request).toHaveBeenCalledWith(
      "knowledge.base.create",
      expect.objectContaining({ visibility: "private" }),
    );
    expect(state.knowledgeUniversePageTab).toBe("workbench");
    expect(runtime.libraryWorkspaceInlineRenameKbId).toBe("kb-new");
    expect(runtime.selectedKnowledgeBaseId).toBe("kb-new");
  });

  it("does not create an enterprise folder without write grant", async () => {
    const client = {
      request: vi.fn(),
    };
    const state = createState({
      client: client as unknown as AppPortState["client"],
      knowledgeUniversePageTab: "workbench",
    });
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.knowledgeBases = [];

    await createKnowledgeUniverseFolderInSection(state, "enterprise");

    expect(client.request).not.toHaveBeenCalled();
    expect(runtime.workspaceNotice).toBeTruthy();
  });
});
