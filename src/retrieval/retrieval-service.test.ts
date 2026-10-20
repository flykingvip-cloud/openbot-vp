// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  getKnowledgeRetrievalService,
  resetKnowledgeRetrievalServiceForTests,
} from "./retrieval-service.js";
import type {
  KnowledgeEvidence,
  RetrievalContext,
  RetrievalOpts,
  RetrievalSource,
  RetrievalSourceKind,
} from "./types.js";

function evidence(
  id: string,
  score: number,
  kind: RetrievalSourceKind = "knowledge",
): KnowledgeEvidence {
  return {
    sourceKind: kind,
    docId: id,
    docTitle: `doc ${id}`,
    kbId: "kb_1",
    versionId: "v1",
    score,
    chunkText: `chunk ${id}`,
    sourceUri: `ku://kb/kb_1/doc/${id}@v1`,
  };
}

function fakeSource(
  id: RetrievalSourceKind,
  results: KnowledgeEvidence[],
  opts?: { throws?: boolean },
): RetrievalSource {
  return {
    id,
    search: async (_query: string, _ctx: RetrievalContext, _opts?: RetrievalOpts) => {
      if (opts?.throws) {
        throw new Error("source failure");
      }
      return results;
    },
  };
}

const ctx: RetrievalContext = { userId: "user-1", seatId: null, tenantId: null };

afterEach(() => {
  resetKnowledgeRetrievalServiceForTests();
});

describe("retrieval-service", () => {
  it("returns empty when query is blank or no sources mounted", async () => {
    const svc = getKnowledgeRetrievalService();
    expect(await svc.search("   ", ctx)).toEqual([]);
    svc.registerSource(fakeSource("knowledge", [evidence("a", 0.9)]));
    expect(await svc.search("  ", ctx)).toEqual([]);
  });

  it("allows a blank query when docId and fallbackToCurrentChunks are set", async () => {
    const svc = getKnowledgeRetrievalService();
    svc.registerSource(fakeSource("knowledge", [evidence("a", 0.9)]));
    expect(await svc.search("  ", ctx, { docId: "a", fallbackToCurrentChunks: true })).toEqual([
      evidence("a", 0.9),
    ]);
    expect(await svc.search("  ", ctx, { docId: "a" })).toEqual([]);
  });

  it("federates across sources and ranks by score descending", async () => {
    const svc = getKnowledgeRetrievalService();
    svc.registerSource(fakeSource("knowledge", [evidence("a", 0.4), evidence("b", 0.9)]));
    svc.registerSource(fakeSource("memory", [evidence("c", 0.7, "memory")]));
    const results = await svc.search("policy", ctx);
    expect(results.map((r) => r.docId)).toEqual(["b", "c", "a"]);
  });

  it("respects maxResults and minScore", async () => {
    const svc = getKnowledgeRetrievalService();
    svc.registerSource(
      fakeSource("knowledge", [evidence("a", 0.2), evidence("b", 0.9), evidence("c", 0.6)]),
    );
    expect((await svc.search("q", ctx, { maxResults: 2 })).map((r) => r.docId)).toEqual(["b", "c"]);
    expect((await svc.search("q", ctx, { minScore: 0.5 })).map((r) => r.docId)).toEqual(["b", "c"]);
  });

  it("isolates a failing source without breaking federation", async () => {
    const svc = getKnowledgeRetrievalService();
    svc.registerSource(fakeSource("knowledge", [evidence("ok", 0.8)]));
    svc.registerSource(fakeSource("web", [], { throws: true }));
    const results = await svc.search("q", ctx);
    expect(results.map((r) => r.docId)).toEqual(["ok"]);
  });

  it("registerSource replaces a source of the same kind and listSources reflects mounts", async () => {
    const svc = getKnowledgeRetrievalService();
    svc.registerSource(fakeSource("knowledge", [evidence("old", 0.5)]));
    svc.registerSource(fakeSource("knowledge", [evidence("new", 0.5)]));
    expect(svc.listSources()).toEqual(["knowledge"]);
    expect((await svc.search("q", ctx)).map((r) => r.docId)).toEqual(["new"]);
  });
});
