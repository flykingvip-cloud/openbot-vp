import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMetadataStore } from "../adapters/local-metadata.js";
import type { Scope } from "../models.js";
import { InMemoryMetadataStore } from "../storage/in-memory.js";
import { InMemoryCogniWeaveEngine } from "./in-memory-engine.js";

const scope: Scope = {
  workspaceId: "ws_write_op",
  projectId: "proj_write_op",
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

describe("CW2-P0-01 writeBack operation idempotency", () => {
  it("same input ×N yields one WRITE op and identical journalId", async () => {
    const store = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store });
    const input = {
      rawInput: "idempotent write body",
      scope,
      sourceType: "chat" as const,
      sourceSessionId: "sess_write_op",
      metadata: {
        openbotPath: "agents/main/sessions/write-op.jsonl",
        syncReason: "watcher",
      },
    };

    const first = await engine.writeBack(input);
    expect(first.status).toBe("COMPLETED");
    const second = await engine.writeBack({
      ...input,
      metadata: {
        ...input.metadata,
        syncReason: "snapshot-restore",
        requestId: "noise",
      },
    });
    expect(second).toEqual(first);

    const ops = [];
    for (let i = 0; i < 20; i += 1) {
      ops.push(await engine.writeBack(input));
    }
    expect(ops.every((op) => op.journalId === first.journalId)).toBe(true);
    expect((await store.listJournals()).length).toBe(1);
  });

  it("persists write_operations across LocalMetadataStore restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cw-write-op-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "meta.sqlite");
    const store1 = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    const engine1 = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store1 });
    const input = {
      rawInput: "persist write op body",
      scope,
      sourceType: "chat" as const,
      metadata: { openbotPath: "agents/main/sessions/persist-op.jsonl" },
    };
    const first = await engine1.writeBack(input);
    const dataPlaneId = await store1.getDataPlaneId();
    expect(dataPlaneId).toBeTruthy();
    store1.close();

    const store2 = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: dbPath,
    });
    expect(await store2.getDataPlaneId()).toBe(dataPlaneId);
    const engine2 = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: store2 });
    const again = await engine2.writeBack(input);
    expect(again).toEqual(first);
    expect((await store2.listJournals()).length).toBe(1);
    store2.close();
  });
});
