import { describe, expect, it, vi } from "vitest";
import { loadKnowledgeUniverseHomeSnapshot } from "./facade.ts";

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

describe("loadKnowledgeUniverseHomeSnapshot incremental settlement", () => {
  it("emits search before a slower relationships call finishes", async () => {
    const relationships = deferred<{ graph: { nodes: unknown[]; edges: unknown[] } }>();
    const client = {
      request: vi.fn((method: string) => {
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
          return relationships.promise;
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
        return Promise.resolve({});
      }),
    };
    const onPartial = vi.fn();
    const pending = loadKnowledgeUniverseHomeSnapshot({
      client: client as never,
      onPartial,
    });
    await vi.waitFor(() => {
      expect(onPartial.mock.calls.some((call) => call[0].settled.includes("search"))).toBe(true);
    });
    expect(onPartial.mock.calls.some((call) => call[0].settled.includes("relationships"))).toBe(
      false,
    );
    relationships.resolve({ graph: { nodes: [], edges: [] } });
    const snapshot = await pending;
    expect(snapshot.graph).toEqual({ nodes: [], edges: [] });
    expect(onPartial.mock.calls.some((call) => call[0].settled.includes("relationships"))).toBe(
      true,
    );
  });

  it("degrades when optional discovery and actions methods are missing", async () => {
    const client = {
      request: vi.fn((method: string) => {
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
          return Promise.resolve({ graph: { nodes: [], edges: [] } });
        }
        if (method === "knowledge.recommendations") {
          return Promise.resolve({ recommendations: [] });
        }
        if (method === "knowledge.discovery.list") {
          return Promise.reject(new Error("unknown method: knowledge.discovery.list"));
        }
        if (method === "knowledge.actions.list") {
          return Promise.reject(new Error("unknown method: knowledge.actions.list"));
        }
        if (method === "knowledge.recent") {
          return Promise.resolve({ visits: [] });
        }
        return Promise.resolve({});
      }),
    };
    const snapshot = await loadKnowledgeUniverseHomeSnapshot({ client: client as never });
    expect(snapshot.discoveryEvents).toEqual([]);
    expect(snapshot.actionSuggestions).toEqual([]);
    expect(snapshot.homeInsightsDegraded).toBe(true);
  });
});
