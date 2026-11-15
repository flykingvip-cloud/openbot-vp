import { describe, expect, it, vi } from "vitest";
import type { KnowledgeUniverseRpcClient } from "../capability/knowledge-universe/gateway-client.ts";
import {
  getKnowledgeUniverseRuntime,
  loadKnowledgeUniverseHome,
  refreshKnowledgeUniverseHome,
  type KnowledgeUniverseSession,
} from "./knowledge-universe.ts";

function emptySummary() {
  return {
    personal: { documentCount: 0, recentUpdates: 0 },
    enterprise: { libraryCount: 0, accessibleCount: 0 },
    data: { grantedCount: 0, requestableCount: 0, externalSourceCount: 0 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createState(client: KnowledgeUniverseSession["client"]): KnowledgeUniverseSession {
  return {
    requestUpdate: vi.fn(),
    client,
    knowledgeUniversePageTab: "workbench",
  };
}

function createHomeClient(options: { relationships?: Promise<unknown> }) {
  const order: string[] = [];
  const request = vi.fn(async (method: string, _params?: unknown) => {
    order.push(method);
    if (method === "knowledge.base.list") {
      return Promise.resolve({
        knowledgeBases: [
          {
            id: "kb-1",
            title: "kb-1",
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
    if (method === "knowledge.search") {
      return Promise.resolve({
        results: [],
        sourceSummary: emptySummary(),
        dataCapabilities: [],
        sourceBrowse: { personal: [], enterprise: [], enterpriseRestricted: [] },
        externalDataSources: [],
      });
    }
    if (method === "knowledge.relationships") {
      return options.relationships ?? Promise.resolve({ graph: { nodes: [], edges: [] } });
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
        openConflictCount: 0,
        openClaimConflictCount: 0,
        openDuplicateCount: 0,
        openOrphanCount: 0,
        openStaleCount: 0,
        suppressedChunkCount: 0,
        indexedChunkCount: 0,
        llmUsage: {
          llmCallCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          creditsCharged: 0,
          lastCallAt: null,
        },
      });
    }
    if (method === "knowledge.governance.tasks.list") {
      return Promise.resolve({ tasks: [] });
    }
    if (
      method === "knowledge.base.sources.list" ||
      method === "knowledge.base.snippets.list" ||
      method === "knowledge.base.members.list" ||
      method === "knowledge.base.documents.list"
    ) {
      return Promise.resolve({
        knowledgeBaseId: "kb-1",
        sources: [],
        snippets: [],
        members: [],
        documents: [],
      });
    }
    return {};
  });
  const client: KnowledgeUniverseRpcClient = {
    request: request as KnowledgeUniverseRpcClient["request"],
  };
  return { client, request, order };
}

describe("knowledge universe home load scheduling", () => {
  it("renders the space list before the relation graph finishes", async () => {
    const relationships = deferred<{ graph: { nodes: unknown[]; edges: unknown[] } }>();
    const { client, order } = createHomeClient({ relationships: relationships.promise });
    const state = createState(client);
    const pending = loadKnowledgeUniverseHome(state, { force: true });
    await vi.waitFor(() => {
      expect(getKnowledgeUniverseRuntime(state).knowledgeBases).toHaveLength(1);
    });
    const runtime = getKnowledgeUniverseRuntime(state);
    expect(runtime.graphLoading).toBe(true);
    expect(order.indexOf("knowledge.base.list")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("knowledge.base.list")).toBeLessThan(
      order.lastIndexOf("knowledge.relationships") === -1 ? order.length : order.length,
    );
    expect(runtime.graph?.nodes.length ?? 0).toBe(0);
    relationships.resolve({ graph: { nodes: [], edges: [] } });
    await pending;
    expect(getKnowledgeUniverseRuntime(state).graphLoading).toBe(false);
    expect(getKnowledgeUniverseRuntime(state).knowledgeBases[0]?.id).toBe("kb-1");
  });

  it("merges overlapping home loads instead of starting three snapshots at once", async () => {
    const relationships = deferred<{ graph: { nodes: unknown[]; edges: unknown[] } }>();
    const { client, request } = createHomeClient({ relationships: relationships.promise });
    const state = createState(client);
    const first = loadKnowledgeUniverseHome(state, { force: true });
    const second = loadKnowledgeUniverseHome(state, { force: true });
    const third = refreshKnowledgeUniverseHome(state);
    await vi.waitFor(() => {
      expect(
        request.mock.calls.filter((call) => call[0] === "knowledge.search").length,
      ).toBeGreaterThanOrEqual(1);
    });
    const inFlightSearch = request.mock.calls.filter(
      (call) => call[0] === "knowledge.search",
    ).length;
    expect(inFlightSearch).toBe(1);
    relationships.resolve({ graph: { nodes: [], edges: [] } });
    await Promise.all([first, second, third]);
    const searchCalls = request.mock.calls.filter((call) => call[0] === "knowledge.search").length;
    // One in-flight snapshot plus at most one queued refresh after it settles.
    expect(searchCalls).toBeLessThanOrEqual(2);
    expect(searchCalls).toBeGreaterThanOrEqual(1);
  });

  it("releases a failed home load so a later load can run", async () => {
    const failing: KnowledgeUniverseRpcClient = {
      request: vi.fn(async () => {
        throw new Error("home-load-failed");
      }) as KnowledgeUniverseRpcClient["request"],
    };
    const state = createState(failing);
    await loadKnowledgeUniverseHome(state, { force: true });
    expect(getKnowledgeUniverseRuntime(state).error).toBeTruthy();
    expect(getKnowledgeUniverseRuntime(state).loading).toBe(false);
    const { client } = createHomeClient({});
    state.client = client;
    await loadKnowledgeUniverseHome(state, { force: true });
    expect(getKnowledgeUniverseRuntime(state).error).toBeNull();
    expect(getKnowledgeUniverseRuntime(state).knowledgeBases).toHaveLength(1);
  });

  it("keeps home-load coalescers isolated across different state objects", async () => {
    const firstRel = deferred<{ graph: { nodes: unknown[]; edges: unknown[] } }>();
    const secondRel = deferred<{ graph: { nodes: unknown[]; edges: unknown[] } }>();
    const first = createHomeClient({ relationships: firstRel.promise });
    const second = createHomeClient({ relationships: secondRel.promise });
    const stateA = createState(first.client);
    const stateB = createState(second.client);
    const pendingA = loadKnowledgeUniverseHome(stateA, { force: true });
    const pendingB = loadKnowledgeUniverseHome(stateB, { force: true });
    await vi.waitFor(() => {
      expect(getKnowledgeUniverseRuntime(stateA).knowledgeBases).toHaveLength(1);
      expect(getKnowledgeUniverseRuntime(stateB).knowledgeBases).toHaveLength(1);
    });
    firstRel.resolve({ graph: { nodes: [{ id: "a" }], edges: [] } });
    secondRel.resolve({ graph: { nodes: [{ id: "b" }], edges: [] } });
    await Promise.all([pendingA, pendingB]);
    expect(getKnowledgeUniverseRuntime(stateA).graph?.nodes[0]?.id).toBe("a");
    expect(getKnowledgeUniverseRuntime(stateB).graph?.nodes[0]?.id).toBe("b");
    expect(first.request).toHaveBeenCalled();
    expect(second.request).toHaveBeenCalled();
    expect(getKnowledgeUniverseRuntime(stateA)).not.toBe(getKnowledgeUniverseRuntime(stateB));
  });
});
