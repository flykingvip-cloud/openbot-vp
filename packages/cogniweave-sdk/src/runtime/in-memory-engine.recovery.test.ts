import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMetadataStore } from "../adapters/local-metadata.js";
import type { Scope } from "../models.js";
import { InMemoryMetadataStore } from "../storage/in-memory.js";
import { InMemoryCogniWeaveEngine } from "./in-memory-engine.js";

const scope: Scope = {
  workspaceId: "ws_recovery",
  projectId: "proj_recovery",
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

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CW2-P0-02/03 restart recovery and journal compact", () => {
  it("restart recoverFromCanonical does not grow WRITE ops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-recovery-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "meta.sqlite");
    const store1 = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    const engine1 = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store1 });
    const input = {
      rawInput: "recovery body once",
      scope,
      sourceType: "chat" as const,
      metadata: { openbotPath: "agents/main/sessions/recovery.jsonl" },
    };
    const first = await engine1.writeBack(input);
    expect(first.status).toBe("COMPLETED");
    expect((await store1.listJournals()).length).toBe(1);
    expect((await store1.listWriteOperations()).length).toBe(1);
    store1.close();

    // Gate P0 acceptance: many restarts must not amplify WRITE/ingestion rows.
    for (let i = 0; i < 100; i += 1) {
      const store = new LocalMetadataStore({
        backend: "local",
        environment: "local",
        path: dbPath,
      });
      const engine = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store });
      const recovered = await engine.recoverFromCanonical({ scope });
      expect(recovered.status).toBe("RECOVERED");
      expect(recovered.journalsRebuilt).toBeGreaterThanOrEqual(1);
      const again = await engine.writeBack(input);
      expect(again.journalId).toBe(first.journalId);
      expect((await store.listJournals()).length).toBe(1);
      expect((await store.listWriteOperations()).length).toBe(1);
      store.close();
    }
  });

  it("compactJournals keeps pinned WRITE journal and FAILED rows", async () => {
    const store = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store });

    const pinned = await engine.writeBack({
      rawInput: "pinned body",
      scope,
      sourceType: "chat",
      metadata: { openbotPath: "agents/main/sessions/pinned.jsonl" },
    });

    // Extra COMPLETED journals not referenced by write_operations.
    for (let i = 0; i < 5; i += 1) {
      await store.putJournal({
        id: `jnl_extra_${i}`,
        eventKey: `evt_extra_${i}`,
        objectIds: {
          eventIds: [],
          atomIds: [],
          entityIds: [],
          scenarioIds: [],
          problemIds: [],
          evidenceIds: [],
          relationIds: [],
        },
        derivedPlan: { graphNodeIds: [], graphEdgeIds: [], vectorDocIds: [] },
        status: "COMPLETED",
        phase: "COMPLETED",
        retryCount: 0,
        updatedAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      });
    }
    await store.putJournal({
      id: "jnl_failed",
      eventKey: "evt_failed",
      objectIds: {
        eventIds: [],
        atomIds: [],
        entityIds: [],
        scenarioIds: [],
        problemIds: [],
        evidenceIds: [],
        relationIds: [],
      },
      derivedPlan: { graphNodeIds: [], graphEdgeIds: [], vectorDocIds: [] },
      status: "FAILED",
      phase: "METADATA_COMMITTED",
      retryCount: 1,
      updatedAt: new Date().toISOString(),
    });

    const dry = await engine.compactJournals({ keepCompleted: 1, dryRun: true });
    expect(dry.status).toBe("DRY_RUN");
    expect(dry.deletedJournalIds.length).toBeGreaterThan(0);
    expect(dry.retainedJournalIds).toContain(pinned.journalId);
    expect(dry.retainedJournalIds).toContain("jnl_failed");
    expect((await store.listJournals()).length).toBe(7);

    const compacted = await engine.compactJournals({ keepCompleted: 1, dryRun: false });
    expect(compacted.status).toBe("COMPACTED");
    const remaining = await store.listJournals();
    expect(remaining.map((j) => j.id)).toContain(pinned.journalId);
    expect(remaining.map((j) => j.id)).toContain("jnl_failed");
    expect(remaining.length).toBe(compacted.retainedJournalIds.length);
  });
});
