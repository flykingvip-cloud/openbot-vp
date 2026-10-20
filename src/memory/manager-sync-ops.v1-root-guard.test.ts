import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { resetEmbeddingMocks } from "./embedding.test-mocks.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";
import { unwrapMemoryIndexManager } from "./test-manager-helpers.js";
import {
  isV1RootGuardError,
  normalizeRootFingerprint,
  normalizeSqliteInstanceId,
  normalizeSqlitePath,
  readMaintenanceUnlockAudit,
  signMaintenanceGrant,
  V1_GUARD_SECRET_ENV,
  V1_GUARD_TOKEN_ENV,
  writeFingerprintsToDb,
  writeSidecar,
} from "./v1-root-guard.js";

const SECRET = "phase0-v1-root-guard-test-secret";

type ManagerInternals = {
  db: DatabaseSync;
  workspaceDir: string;
  resetIndex: () => void;
  pruneEmbeddingCacheIfNeeded: () => void;
  runUnsafeReindex: (params?: { reason?: string; force?: boolean }) => Promise<void>;
  cache: { enabled: boolean; maxEntries?: number };
};

function asInternals(manager: MemoryIndexManager): ManagerInternals {
  return unwrapMemoryIndexManager(manager) as unknown as ManagerInternals;
}

function createCfg(params: { workspaceDir: string; indexPath: string }): OpenBotConfig {
  return {
    agents: {
      defaults: {
        workspace: params.workspaceDir,
        memorySearch: {
          provider: "openai",
          model: "mock-embed",
          store: { path: params.indexPath },
          cache: { enabled: true, maxEntries: 1 },
          query: { minScore: 0, hybrid: { enabled: true } },
          sync: { watch: false, onSessionStart: false, onSearch: false },
        },
      },
      list: [{ id: "main", default: true }],
    },
  } as OpenBotConfig;
}

function seedIndexRows(db: DatabaseSync): void {
  db.prepare(
    `INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`,
  ).run("keep.md", "memory", "hash-keep", Date.now(), 12);
  db.prepare(
    `INSERT OR REPLACE INTO files (path, source, hash, mtime, size) VALUES (?, ?, ?, ?, ?)`,
  ).run("stale.md", "memory", "hash-stale", Date.now(), 8);
  db.prepare(
    `INSERT OR REPLACE INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "chunk-keep",
    "keep.md",
    "memory",
    1,
    1,
    "hash-keep",
    "mock-embed",
    "keep unique zebra",
    "[]",
    Date.now(),
  );
  db.prepare(
    `INSERT OR REPLACE INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("openai", "mock-embed", "k", "old-1", "[]", 3, 1);
  db.prepare(
    `INSERT OR REPLACE INTO embedding_cache (provider, model, provider_key, hash, embedding, dims, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("openai", "mock-embed", "k", "old-2", "[]", 3, 2);
  db.exec(`CREATE TABLE IF NOT EXISTS chunks_vec (id TEXT PRIMARY KEY)`);
  db.prepare(`INSERT OR REPLACE INTO chunks_vec (id) VALUES (?)`).run("vec-keep");
  db.exec(
    `CREATE TABLE IF NOT EXISTS chunks_fts (text TEXT, id TEXT, path TEXT, source TEXT, model TEXT)`,
  );
  db.prepare(`INSERT INTO chunks_fts (text, id, path, source, model) VALUES (?, ?, ?, ?, ?)`).run(
    "keep unique zebra",
    "chunk-keep",
    "keep.md",
    "memory",
    "mock-embed",
  );
}

function snapshot(db: DatabaseSync) {
  const files = db.prepare(`SELECT path FROM files ORDER BY path`).all() as Array<{ path: string }>;
  const chunks = db.prepare(`SELECT id FROM chunks ORDER BY id`).all() as Array<{ id: string }>;
  const cache = db.prepare(`SELECT hash FROM embedding_cache ORDER BY hash`).all() as Array<{
    hash: string;
  }>;
  const vec = db.prepare(`SELECT id FROM chunks_vec ORDER BY id`).all() as Array<{ id: string }>;
  const fts = db.prepare(`SELECT id FROM chunks_fts ORDER BY id`).all() as Array<{ id: string }>;
  return { files, chunks, cache, vec, fts };
}

function installDestructiveProbe(db: DatabaseSync): { sql: string[] } {
  const captured = { sql: [] as string[] };
  const originalExec = db.exec.bind(db);
  const originalPrepare = db.prepare.bind(db);
  db.exec = ((sql: string) => {
    if (/\b(DELETE|DROP)\b/i.test(sql)) {
      captured.sql.push(sql);
    }
    return originalExec(sql);
  }) as DatabaseSync["exec"];
  db.prepare = ((sql: string) => {
    const stmt = originalPrepare(sql);
    if (/\b(DELETE|DROP)\b/i.test(sql)) {
      const originalRun = stmt.run.bind(stmt);
      stmt.run = ((...args: unknown[]) => {
        captured.sql.push(sql);
        return originalRun(...(args as Parameters<typeof originalRun>));
      }) as typeof stmt.run;
    }
    return stmt;
  }) as DatabaseSync["prepare"];
  return captured;
}

describe("memory manager v1 root guard wiring", () => {
  let workspaceDir = "";
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    resetEmbeddingMocks();
    vi.stubEnv("OPENCLAW_TEST_MEMORY_UNSAFE_REINDEX", "1");
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-v1-guard-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Hello memory zebra.");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (manager) {
      await manager.close();
      manager = null;
    }
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  async function openManager(indexName: string): Promise<MemoryIndexManager> {
    const indexPath = path.join(workspaceDir, indexName);
    const result = await getMemorySearchManager({
      cfg: createCfg({ workspaceDir, indexPath }),
      agentId: "main",
    });
    if (!result.manager) {
      throw new Error("manager missing");
    }
    manager = result.manager as MemoryIndexManager;
    return manager;
  }

  it("refuses unregistered sync/prune/reset/rebuild and leaves files/chunks/FTS/vector intact", async () => {
    const current = await openManager("main.sqlite");
    const internals = asInternals(current);
    seedIndexRows(internals.db);
    const before = snapshot(internals.db);
    const probe = installDestructiveProbe(internals.db);

    await expect(current.sync({ reason: "test" })).rejects.toSatisfy((error: unknown) => {
      return isV1RootGuardError(error) && error.decision.reason === "unregistered-v1-fail-closed";
    });
    const guardStatus = current.status().custom?.v1RootGuard as {
      indexStatus?: string;
      reason?: string;
      refusedOp?: string;
    };
    expect(current.status().custom?.indexStatus).toBe("unknown");
    expect(guardStatus?.indexStatus).toBe("unknown");
    expect(guardStatus?.reason).toBe("unregistered-v1-fail-closed");
    expect(guardStatus?.refusedOp).toBe("rebuild");

    await expect(current.sync({ force: true })).rejects.toSatisfy(isV1RootGuardError);
    expect(() => internals.resetIndex()).toThrow(/v1-operation-not-authorized/);
    expect(() => internals.pruneEmbeddingCacheIfNeeded()).toThrow(/v1-operation-not-authorized/);
    const resetSpy = vi.spyOn(internals, "resetIndex");
    await expect(internals.runUnsafeReindex({ force: true })).rejects.toSatisfy(isV1RootGuardError);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(snapshot(internals.db)).toEqual(before);
    expect(probe.sql.some((sql) => /DELETE FROM files/i.test(sql))).toBe(false);
    expect(probe.sql.some((sql) => /DELETE FROM chunks/i.test(sql))).toBe(false);
    expect(probe.sql.some((sql) => /DELETE FROM chunks_fts/i.test(sql))).toBe(false);
    expect(probe.sql.some((sql) => /DROP TABLE IF EXISTS chunks_vec/i.test(sql))).toBe(false);
    expect(before.files.map((row) => row.path)).toEqual(["keep.md", "stale.md"]);
  });

  it("refuses dual-root sidecar evidence even after a same-root register", async () => {
    const current = await openManager("agent-a.sqlite");
    const internals = asInternals(current);
    writeSidecar(path.join(workspaceDir, "agent-a.sqlite.v1-root-guard.json"), {
      fingerprints: [normalizeRootFingerprint(internals.workspaceDir), "/other/workspace-agent-a"],
    });
    writeFingerprintsToDb(internals.db, [normalizeRootFingerprint(internals.workspaceDir)]);
    seedIndexRows(internals.db);
    const before = snapshot(internals.db);
    const probe = installDestructiveProbe(internals.db);

    await expect(current.sync({ reason: "test" })).rejects.toSatisfy((error: unknown) => {
      return isV1RootGuardError(error) && error.decision.reason === "known-conflict-preset-deny";
    });
    const guardStatus = current.status().custom?.v1RootGuard as {
      indexStatus?: string;
      reason?: string;
      refusedOp?: string;
    };
    expect(current.status().custom?.indexStatus).toBe("degraded");
    expect(guardStatus?.indexStatus).toBe("degraded");
    expect(guardStatus?.reason).toBe("known-conflict-preset-deny");
    expect(guardStatus?.refusedOp).toBe("rebuild");

    expect(() => internals.resetIndex()).toThrow(/v1-operation-not-authorized/);
    expect(() => internals.pruneEmbeddingCacheIfNeeded()).toThrow(/v1-operation-not-authorized/);
    expect(snapshot(internals.db)).toEqual(before);
    expect(probe.sql).toEqual([]);
  });

  it("refuses root mismatch and keeps stale rows", async () => {
    const current = await openManager("main.sqlite");
    const internals = asInternals(current);
    writeFingerprintsToDb(internals.db, ["/other/workspace-main"]);
    seedIndexRows(internals.db);
    const before = snapshot(internals.db);
    const probe = installDestructiveProbe(internals.db);

    await expect(current.sync({ force: true })).rejects.toSatisfy((error: unknown) => {
      return (
        isV1RootGuardError(error) && error.decision.reason === "v1-multi-root-or-root-mismatch"
      );
    });
    expect(snapshot(internals.db).files).toEqual(before.files);
    expect(snapshot(internals.db).chunks).toEqual(before.chunks);
    expect(probe.sql).toEqual([]);
  });

  it("rejects forged, expired, wrong-db, and wrong-op grants and does not mutate", async () => {
    const sqlitePath = path.join(workspaceDir, "bot-2.sqlite");
    const current = await openManager("bot-2.sqlite");
    const internals = asInternals(current);
    seedIndexRows(internals.db);
    const before = snapshot(internals.db);

    vi.stubEnv(V1_GUARD_SECRET_ENV, SECRET);
    vi.stubEnv(V1_GUARD_TOKEN_ENV, "v1.forged.token");
    await expect(current.sync({ force: true })).rejects.toSatisfy(isV1RootGuardError);

    const expired = signMaintenanceGrant({
      secret: SECRET,
      sqlitePath,
      op: "rebuild",
      reason: "expired",
      issuedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    vi.stubEnv(V1_GUARD_TOKEN_ENV, expired);
    await expect(current.sync({ force: true })).rejects.toSatisfy(isV1RootGuardError);

    const otherDb = signMaintenanceGrant({
      secret: SECRET,
      sqlitePath: path.join(workspaceDir, "other.sqlite"),
      op: "rebuild",
      reason: "wrong-db",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.stubEnv(V1_GUARD_TOKEN_ENV, otherDb);
    await expect(current.sync({ force: true })).rejects.toSatisfy(isV1RootGuardError);

    const wrongOp = signMaintenanceGrant({
      secret: SECRET,
      sqlitePath,
      op: "prune",
      reason: "wrong-op",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.stubEnv(V1_GUARD_TOKEN_ENV, wrongOp);
    await expect(current.sync({ force: true })).rejects.toSatisfy(isV1RootGuardError);

    expect(snapshot(internals.db)).toEqual(before);
    expect(readMaintenanceUnlockAudit(sqlitePath)).toEqual([]);
  });

  it("accepts a matching grant only for that sqlite instance and op", async () => {
    const sqlitePath = path.join(workspaceDir, "bot-2.sqlite");
    const current = await openManager("bot-2.sqlite");
    const internals = asInternals(current);
    seedIndexRows(internals.db);
    const token = signMaintenanceGrant({
      secret: SECRET,
      sqlitePath,
      op: "rebuild",
      reason: "approved-rollback-drill",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.stubEnv(V1_GUARD_SECRET_ENV, SECRET);
    vi.stubEnv(V1_GUARD_TOKEN_ENV, token);
    expect(readMaintenanceUnlockAudit(sqlitePath)).toEqual([]);
    await expect(current.sync({ force: true })).resolves.toBeUndefined();
    expect(current.status().files).toBeGreaterThan(0);
    const audit = readMaintenanceUnlockAudit(sqlitePath);
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]).toMatchObject({
      action: "maintenance-unlock",
      sqliteInstance: normalizeSqliteInstanceId(sqlitePath),
      sqlitePath: normalizeSqlitePath(sqlitePath),
      op: "rebuild",
      reason: "approved-rollback-drill",
      tokenVerified: true,
    });
    expect(typeof audit[0]?.iat).toBe("string");
    expect(typeof audit[0]?.exp).toBe("string");
    expect(typeof audit[0]?.recordedAt).toBe("string");
  });

  it("keeps readonly search/status working on an unregistered db", async () => {
    const current = await openManager("main.sqlite");
    const internals = asInternals(current);
    seedIndexRows(internals.db);
    const before = snapshot(internals.db);

    const status = current.status();
    expect(status.files).toBe(2);
    expect(status.chunks).toBe(1);
    expect(status.workspaceDir).toBe(internals.workspaceDir);
    expect(String(status.workspaceDir).includes("ws:")).toBe(false);

    const results = await current.search("zebra");
    expect(Array.isArray(results)).toBe(true);
    expect(snapshot(internals.db)).toEqual(before);
  });

  it("allows confirmed isolated single-root sync after explicit register", async () => {
    const current = await openManager("index.sqlite");
    const internals = asInternals(current);
    writeFingerprintsToDb(internals.db, [normalizeRootFingerprint(internals.workspaceDir)]);
    await current.sync({ force: true });
    expect(current.status().files).toBeGreaterThan(0);
    expect(current.status().chunks).toBeGreaterThan(0);
    const results = await current.search("zebra");
    expect(results.length).toBeGreaterThan(0);
  });
});
