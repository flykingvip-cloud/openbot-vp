import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import * as acquireMod from "./acquire-sync-auth.js";
import { createMemoryHealthProbe } from "./health-probe.factory.js";
import { createWalBackedSqlite } from "./health-probe.test-fixtures.js";
import type { MemoryIndexManager } from "./index.js";
import { createOpenAIEmbeddingProviderMock } from "./test-embeddings-mock.js";
import { unwrapMemoryIndexManager } from "./test-manager-helpers.js";
import { createMemoryManagerOrThrow } from "./test-manager.js";
import * as v1RootGuard from "./v1-root-guard.js";
import {
  normalizeRootFingerprint,
  sidecarPathForSqlite,
  writeFingerprintsToDb,
  writeSidecar,
} from "./v1-root-guard.js";

const embedBatch = vi.fn(
  async (input: string[]): Promise<number[][]> => input.map(() => [0.2, 0.2, 0.2]),
);
const embedQuery = vi.fn(async (_input: string): Promise<number[]> => [0.2, 0.2, 0.2]);

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async (_options: unknown) =>
    createOpenAIEmbeddingProviderMock({
      embedQuery: embedQuery as unknown as (input: string) => Promise<number[]>,
      embedBatch: embedBatch as unknown as (input: string[]) => Promise<number[][]>,
    }),
}));

type ManagerInternals = {
  db: DatabaseSync;
  dirty: boolean;
  sessionsDirty: boolean;
  workspaceDir: string;
  sync: (params?: { reason?: string; force?: boolean }) => Promise<void>;
};

function asInternals(manager: object): ManagerInternals {
  return unwrapMemoryIndexManager(manager) as unknown as ManagerInternals;
}

function firstMockResultValue(spy: { mock: { results: unknown } }): unknown {
  const results = spy.mock.results as Array<{ value?: unknown }>;
  return results.at(0)?.value;
}

function firstMockCallArg(mockFn: { mock: { calls: unknown } }): unknown {
  const calls = mockFn.mock.calls as unknown[][];
  return calls.at(0)?.at(0);
}

describe("memory search operation boundary (CQ-O1a S1–S10)", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  const buildConfig = (onSearch = true): OpenBotConfig =>
    ({
      agents: {
        defaults: {
          workspace: workspaceDir,
          memorySearch: {
            provider: "openai",
            model: "text-embedding-3-small",
            store: { path: indexPath },
            sync: { watch: false, onSessionStart: false, onSearch },
            query: { minScore: 0 },
            remote: { batch: { enabled: false, wait: false } },
          },
        },
        list: [{ id: "main", default: true }],
      },
    }) as OpenBotConfig;

  beforeEach(async () => {
    embedBatch.mockClear();
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mem-o1a-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    await fs.mkdir(path.join(workspaceDir, "memory"));
    await fs.writeFile(path.join(workspaceDir, "memory", "2026-01-07.md"), "hello\n");
  });

  afterEach(async () => {
    acquireMod.resetSearchSyncFlightsForTests();
    vi.restoreAllMocks();
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  async function boot(): Promise<ManagerInternals> {
    manager = await createMemoryManagerOrThrow(buildConfig());
    return asInternals(manager);
  }

  it("S1: dirty=false does not acquire or sync", async () => {
    const inner = await boot();
    inner.dirty = false;
    inner.sessionsDirty = false;
    const acquireSpy = vi.spyOn(acquireMod, "acquireSyncAuth");
    const syncMock = vi.fn(async () => {});
    inner.sync = syncMock;
    await manager!.search("hello");
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("S2: dirty + registered fingerprint acquires once and syncs once", async () => {
    const inner = await boot();
    inner.dirty = true;
    const acquireSpy = vi.spyOn(acquireMod, "acquireSyncAuth");
    const syncMock = vi.fn(async () => {});
    inner.sync = syncMock;
    await manager!.search("hello");
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(firstMockResultValue(acquireSpy)).toMatchObject({ ok: true });
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(firstMockCallArg(syncMock)).toEqual({ reason: "search" });
  });

  it("S3: concurrent follower does not acquire again", async () => {
    const inner = await boot();
    inner.dirty = true;
    const acquireSpy = vi.spyOn(acquireMod, "acquireSyncAuth");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const syncMock = vi.fn(async () => gate);
    inner.sync = syncMock;
    const first = manager!.search("hello");
    const second = manager!.search("hello");
    await Promise.all([first, second]);
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledTimes(1);
    release();
  });

  it("S4: authority.unknown does not sync", async () => {
    const inner = await boot();
    writeFingerprintsToDb(inner.db, []);
    inner.dirty = true;
    const acquireSpy = vi.spyOn(acquireMod, "acquireSyncAuth");
    const syncMock = vi.fn(async () => {});
    inner.sync = syncMock;
    await manager!.search("hello");
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(firstMockResultValue(acquireSpy)).toMatchObject({
      ok: false,
      reasonCode: "authority.unknown",
    });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("S5: topology.multiple does not sync", async () => {
    const inner = await boot();
    writeFingerprintsToDb(inner.db, [
      normalizeRootFingerprint(inner.workspaceDir),
      "/other/workspace-root",
    ]);
    inner.dirty = true;
    const acquireSpy = vi.spyOn(acquireMod, "acquireSyncAuth");
    const syncMock = vi.fn(async () => {});
    inner.sync = syncMock;
    await manager!.search("hello");
    expect(firstMockResultValue(acquireSpy)).toMatchObject({
      ok: false,
      reasonCode: "topology.multiple",
    });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("S6: destructive.denied does not sync", async () => {
    const inner = await boot();
    writeFingerprintsToDb(inner.db, ["/other/workspace-root"]);
    inner.dirty = true;
    const acquireSpy = vi.spyOn(acquireMod, "acquireSyncAuth");
    const syncMock = vi.fn(async () => {});
    inner.sync = syncMock;
    await manager!.search("hello");
    expect(firstMockResultValue(acquireSpy)).toMatchObject({
      ok: false,
      reasonCode: "destructive.denied",
    });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("S7: destructive.grant-required does not sync", async () => {
    const inner = await boot();
    writeSidecar(sidecarPathForSqlite(indexPath), {
      fingerprints: [normalizeRootFingerprint(inner.workspaceDir), "/other/workspace-root"],
    });
    inner.dirty = true;
    const acquireSpy = vi.spyOn(acquireMod, "acquireSyncAuth");
    const syncMock = vi.fn(async () => {});
    inner.sync = syncMock;
    await manager!.search("hello");
    expect(firstMockResultValue(acquireSpy)).toMatchObject({
      ok: false,
      reasonCode: "destructive.grant-required",
    });
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("S8: search force/rebuild/reset is refused", async () => {
    const inner = await boot();
    inner.dirty = true;
    const acquireSpy = vi.spyOn(acquireMod, "acquireSyncAuth");
    const syncMock = vi.fn(async () => {});
    inner.sync = syncMock;
    await manager!.search("hello", {
      force: true,
      rebuild: true,
      reset: true,
    } as { maxResults?: number; force?: boolean; rebuild?: boolean; reset?: boolean });
    expect(acquireSpy).not.toHaveBeenCalled();
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("S9: expired auth is not reused; status does not re-acquire", async () => {
    const inner = await boot();
    inner.dirty = true;
    const acquireSpy = vi.spyOn(acquireMod, "acquireSyncAuth");
    const syncMock = vi.fn(async () => {});
    inner.sync = syncMock;
    await manager!.search("hello");
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    const first = firstMockResultValue(acquireSpy) as acquireMod.AcquireSyncAuthResult;
    expect(first.ok).toBe(true);
    const expired = acquireMod.validateAcquireSyncAuth(first, Date.now() + 20_000);
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.reasonCode).toBe("auth.expired");
    }
    manager!.status();
    expect(acquireSpy).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it("S10: status and health probe do not read env grant or create auth", async () => {
    const inner = await boot();
    const unlockSpy = vi.spyOn(v1RootGuard, "readV1RootGuardUnlockFromEnv");
    const createSpy = vi.spyOn(v1RootGuard, "createV1OperationAuth");
    manager!.status();
    expect(unlockSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();

    const probeRoot = path.join(workspaceDir, "probe");
    const probeIndex = path.join(probeRoot, "agent.sqlite");
    const probeWorkspace = path.join(probeRoot, "workspace");
    await fs.mkdir(path.join(probeWorkspace, "memory"), { recursive: true });
    await fs.writeFile(path.join(probeWorkspace, "memory", "a.md"), "# note\n");
    createWalBackedSqlite(probeIndex);
    createMemoryHealthProbe().probeAgent({
      agentId: "main",
      workspaceRoot: probeWorkspace,
      indexPath: probeIndex,
    });
    expect(unlockSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(inner.dirty).toBeTypeOf("boolean");
  });
});
