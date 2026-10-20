import { describe, expect, it } from "vitest";
import {
  InMemoryCogniWeaveEngine,
  InMemoryMetadataStore,
  InMemoryVectorStore,
  createMemoryPartitionKeyV1,
  createMemorySubjectBinding,
} from "../index.js";
import type { MemoryAtom, RelationRecord, Scope } from "../models.js";
import { mergeHybridScores, scoreAtomLexical } from "../retrieval/hybrid.js";

const scope: Scope = {
  workspaceId: "ws_hyb",
  projectId: "proj_hyb",
  agentId: "agent_main",
  visibility: "private",
};

function makeAtom(id: string, statement: string): MemoryAtom {
  return {
    id,
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement },
    trigger: { conditions: ["latency"], contextTags: ["ops"] },
    applicability: { include: ["incident"], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: [] },
    versioning: { version: 1 },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: 0.8, reuseCount: 0 },
  };
}

function makeRelation(fromId: string, toId: string): RelationRecord {
  return {
    id: `rel_${fromId}_${toId}`,
    fromId,
    fromNodeType: "MemoryAtom",
    relationType: "RELATED_TO",
    toId,
    toNodeType: "MemoryAtom",
    scope,
    confidence: 0.9,
    status: "active",
    provenance: { sourceEventIds: [], evidenceRefs: [] },
  };
}

async function boundEngine(atoms: MemoryAtom[], relations: RelationRecord[] = []) {
  const store = new InMemoryMetadataStore();
  const vectorStore = new InMemoryVectorStore();
  const engine = new InMemoryCogniWeaveEngine(
    {
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    },
    { metadataStore: store, vectorStore },
  );
  const dataPlaneId = await store.ensureDataPlaneId();
  const partition = createMemoryPartitionKeyV1(dataPlaneId, scope);
  const caller = { tenantId: "tenant_hyb", ownerType: "user" as const, ownerId: "user_hyb" };
  await store.saveMemorySubjectBinding(
    createMemorySubjectBinding({
      partition,
      scope,
      subject: caller,
      scopeType: "personal",
    }),
  );
  for (const atom of atoms) {
    await store.saveAtom(atom);
  }
  for (const relation of relations) {
    await store.saveRelation(relation);
  }
  await vectorStore.rebuildFromBundle({
    events: [],
    atoms,
    entities: [],
    scenarios: [],
    problems: [],
    evidence: [],
    relations,
  });
  return { engine, caller, store, vectorStore };
}

describe("CW2-P4-02 queryAtomsHybrid", () => {
  it("ranks lexical matches above unrelated atoms", async () => {
    const { engine, caller } = await boundEngine([
      makeAtom("atm_match", "Prefer async buffering under high latency"),
      makeAtom("atm_noise", "Weekly standup notes and snacks"),
    ]);
    const hits = await engine.queryAtomsHybrid({
      scope,
      caller,
      query: "async buffering latency",
      maxResults: 5,
      minScore: 0.05,
    });
    expect(hits[0]?.atom.id).toBe("atm_match");
    expect(hits[0]?.explain.channels.fts).toBeGreaterThan(0);
    expect(hits[0]?.explain.matchedTokens.length).toBeGreaterThan(0);
  });

  it("applies relation boost to neighbor atoms", async () => {
    const seed = makeAtom("atm_seed", "alert noise reduction playbook");
    const neighbor = makeAtom("atm_neighbor", "generic operations checklist");
    const { engine, caller } = await boundEngine(
      [seed, neighbor],
      [makeRelation("atm_seed", "atm_neighbor")],
    );
    const hits = await engine.queryAtomsHybrid({
      scope,
      caller,
      query: "alert noise reduction",
      enableVector: false,
      maxResults: 5,
      minScore: 0,
    });
    const neighborHit = hits.find((hit) => hit.atom.id === "atm_neighbor");
    expect(neighborHit).toBeTruthy();
    expect(neighborHit?.explain.channels.graphBoost).toBeGreaterThan(0);
  });

  it("keeps ACL fail-closed for unauthorized callers", async () => {
    const { engine } = await boundEngine([makeAtom("atm_x", "secret buffering strategy")]);
    const hits = await engine.queryAtomsHybrid({
      scope,
      caller: { tenantId: "tenant_other", ownerType: "user", ownerId: "user_hyb" },
      query: "buffering strategy",
    });
    expect(hits).toEqual([]);
  });

  it("works when vector search is disabled", async () => {
    const { engine, caller } = await boundEngine([
      makeAtom("atm_only_fts", "circuit breaker for retries"),
    ]);
    const hits = await engine.queryAtomsHybrid({
      scope,
      caller,
      query: "circuit breaker",
      enableVector: false,
      enableGraphBoost: false,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.explain.channels.vector).toBeUndefined();
  });
});

describe("CW2-P4-02 hybrid helpers", () => {
  it("merges channel scores deterministically", () => {
    const lexical = scoreAtomLexical("async buffering", makeAtom("a1", "async buffering path"));
    expect(lexical.score).toBeGreaterThan(0);
    const merged = mergeHybridScores({
      fts: [{ atomId: "a1", score: 0.8, matchedTokens: ["async"] }],
      vector: [{ atomId: "a1", score: 0.4 }],
      graphBoost: new Map([["a1", 0.1]]),
    });
    expect(merged[0]?.atomId).toBe("a1");
    expect(merged[0]?.channels).toEqual({ fts: 0.8, vector: 0.4, graphBoost: 0.1 });
  });
});
