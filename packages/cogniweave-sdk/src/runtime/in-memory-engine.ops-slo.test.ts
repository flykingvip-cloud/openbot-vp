import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMetadataStore } from "../adapters/local-metadata.js";
import type { EvidenceRecord, MemoryAtom, Scope, WriteJournal } from "../models.js";
import { InMemoryCogniWeaveEngine } from "./in-memory-engine.js";

/**
 * CW2-P0-04 Ops SLO soak (local durable).
 *
 * Default CI scale is smaller for wall-time; set COGNIWEAVE_SLO_SOAK_ATOMS=10000
 * for the plan Gate target (p95 recover < 5s on warm FS).
 */

const scope: Scope = {
  workspaceId: "ws_ops_slo",
  projectId: "proj_ops_slo",
  agentId: "agent_main",
  visibility: "private",
};

const engineConfig = {
  environment: "local" as const,
  metadataBackend: "memory" as const,
  graphBackend: "memory" as const,
  evidenceBackend: "memory" as const,
  vectorBackend: "memory" as const,
};

const ATOM_COUNT = Math.max(
  50,
  Number.parseInt(process.env.COGNIWEAVE_SLO_SOAK_ATOMS ?? "800", 10) || 800,
);
const RECOVER_ROUNDS = Math.max(
  3,
  Number.parseInt(process.env.COGNIWEAVE_SLO_SOAK_RECOVER_ROUNDS ?? "8", 10) || 8,
);
/** Plan target for 10k; scale linearly for smaller CI seeds with a floor. */
const RECOVER_P95_BUDGET_MS =
  ATOM_COUNT >= 10_000 ? 5_000 : Math.max(1_500, Math.ceil((ATOM_COUNT / 10_000) * 5_000) + 500);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx]!;
}

function makeAtom(id: string, evidenceId: string, index: number): MemoryAtom {
  return {
    id,
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement: `ops slo claim ${index}` },
    trigger: { conditions: [], contextTags: [`tag_${index % 17}`] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: [evidenceId] },
    versioning: { version: 1 },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: 0.7, reuseCount: 0 },
  };
}

function makeEvidence(id: string, index: number): EvidenceRecord {
  return {
    id,
    type: "document",
    uri: `memory/ops-slo/${index}.md`,
    snippet: `OpsSloPhraseUnique${index} recoverable evidence body`,
    trustScore: 0.9,
    scope,
    locator: { messageIds: [], toolCallIds: [] },
  };
}

function makeJournal(id: string, atomId: string, evidenceId: string, index: number): WriteJournal {
  return {
    id,
    eventKey: `evt_ops_slo_${index}`,
    objectIds: {
      eventIds: [],
      atomIds: [atomId],
      entityIds: [],
      scenarioIds: [],
      problemIds: [],
      evidenceIds: [evidenceId],
      relationIds: [],
    },
    derivedPlan: { graphNodeIds: [], graphEdgeIds: [], vectorDocIds: [] },
    status: "COMPLETED",
    phase: "COMPLETED",
    retryCount: 0,
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString(),
  };
}

async function seedCanonicalStore(store: LocalMetadataStore, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const evidenceId = `ev_ops_slo_${i}`;
    const atomId = `atm_ops_slo_${i}`;
    const journalId = `jnl_ops_slo_${i}`;
    await store.saveEvidence(makeEvidence(evidenceId, i));
    await store.saveAtom(makeAtom(atomId, evidenceId, i));
    await store.putJournal(makeJournal(journalId, atomId, evidenceId, i));
  }
}

describe("CW2-P0-04 Ops SLO soak (local durable)", () => {
  it(
    `recoverFromCanonical p95 under budget for ${ATOM_COUNT} atoms (${RECOVER_ROUNDS} restarts)`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "cw-ops-slo-"));
      tempDirs.push(dir);
      const dbPath = join(dir, "meta.sqlite");

      const seedStore = new LocalMetadataStore({
        backend: "local",
        environment: "local",
        path: dbPath,
      });
      await seedCanonicalStore(seedStore, ATOM_COUNT);
      const seedWriteOps =
        typeof seedStore.listWriteOperations === "function"
          ? (await seedStore.listWriteOperations()).length
          : 0;
      expect(seedWriteOps).toBe(0);
      expect((await seedStore.listAtoms()).length).toBe(ATOM_COUNT);
      seedStore.close();

      const sizeBefore = (await stat(dbPath)).size;
      const recoverMs: number[] = [];

      for (let round = 0; round < RECOVER_ROUNDS; round += 1) {
        const store = new LocalMetadataStore({
          backend: "local",
          environment: "local",
          path: dbPath,
        });
        const engine = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store });
        const started = performance.now();
        const recovered = await engine.recoverFromCanonical({ scope });
        recoverMs.push(performance.now() - started);
        expect(recovered.status).toBe("RECOVERED");
        expect(recovered.journalsRebuilt).toBe(ATOM_COUNT);
        expect(recovered.writeOperationCount).toBe(0);
        expect((await store.listWriteOperations()).length).toBe(0);
        store.close();
      }

      const sorted = [...recoverMs].toSorted((a, b) => a - b);
      const p95 = percentile(sorted, 95);
      expect(p95).toBeLessThan(RECOVER_P95_BUDGET_MS);

      const sizeAfter = (await stat(dbPath)).size;
      // Idle recover must not inflate the durable DB (allow tiny SQLite freelist churn).
      expect(sizeAfter).toBeLessThanOrEqual(sizeBefore + 64 * 1024);
      expect(Math.round(p95)).toBeGreaterThan(0);
    },
    Math.max(60_000, ATOM_COUNT * 20),
  );

  it("searchEvidence stays responsive on seeded local store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-ops-slo-search-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "meta.sqlite");
    const seedCount = Math.min(ATOM_COUNT, 800);
    const store = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    await seedCanonicalStore(store, seedCount);
    const engine = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store });
    await engine.recoverFromCanonical({ scope });

    const probeIndex = Math.floor(seedCount / 2);
    const samples: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const started = performance.now();
      const hits = await engine.searchEvidence(`OpsSloPhraseUnique${probeIndex}`, { scope });
      samples.push(performance.now() - started);
      expect(hits.some((hit) => hit.evidence.uri?.includes(`/${probeIndex}.md`))).toBe(true);
    }
    store.close();

    const sorted = [...samples].toSorted((a, b) => a - b);
    const p95 = percentile(sorted, 95);
    // Local hot FTS/meta target ≤100ms at ≤10k; CI seeds are smaller — keep a soft ceiling.
    const searchBudgetMs = seedCount >= 10_000 ? 100 : 250;
    expect(p95).toBeLessThan(searchBudgetMs);
  });
});
