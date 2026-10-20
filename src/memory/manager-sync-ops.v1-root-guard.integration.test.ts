import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { resetEmbeddingMocks } from "./embedding.test-mocks.js";
import { getMemorySearchManager, type MemoryIndexManager } from "./index.js";
import { closeAllMemoryIndexManagers } from "./manager.js";
import { unwrapMemoryIndexManager } from "./test-manager-helpers.js";
import { seedIndexRows, snapshotIndexData } from "./v1-root-guard-index-snapshot.js";
import {
  isV1RootGuardError,
  normalizeRootFingerprint,
  normalizeSqliteInstanceId,
  readMaintenanceUnlockAudit,
  signMaintenanceGrant,
  V1_GUARD_SECRET_ENV,
  V1_GUARD_TOKEN_ENV,
  writeFingerprintsToDb,
  writeSidecar,
} from "./v1-root-guard.js";
import * as v1RootGuard from "./v1-root-guard.js";

const SECRET = "phase0-v1-root-guard-integration-secret";
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(THIS_DIR, "../..");
const CHILD_PROBE = path.join(THIS_DIR, "v1-root-guard-process-probe.ts");
const CONCURRENT_PROBE = path.join(THIS_DIR, "v1-root-guard-concurrent-probe.ts");

type ManagerInternals = {
  db: DatabaseSync;
  ensureVectorReady: (dimensions?: number) => Promise<boolean>;
};

function asInternals(manager: MemoryIndexManager): ManagerInternals {
  return unwrapMemoryIndexManager(manager) as unknown as ManagerInternals;
}

function createCfg(params: {
  workspaceDir: string;
  indexPath: string;
  sources?: Array<"memory" | "sessions">;
  agentIds?: string[];
}): OpenBotConfig {
  const sources = params.sources ?? ["memory"];
  return {
    agents: {
      defaults: {
        workspace: params.workspaceDir,
        memorySearch: {
          provider: "openai",
          model: "mock-embed",
          store: { path: params.indexPath },
          cache: { enabled: false },
          query: { minScore: 0, hybrid: { enabled: false } },
          sync: { watch: false, onSessionStart: false, onSearch: false },
          sources,
        },
      },
      list: (params.agentIds ?? ["main"]).map((id, index) => ({
        id,
        default: index === 0,
      })),
    },
  } as OpenBotConfig;
}

function isIndexDataMutationSql(sql: string): boolean {
  if (/_openbot_v1_root_guard/i.test(sql)) {
    return false;
  }
  return (
    /\b(DELETE|DROP|INSERT|UPDATE|CREATE)\b/i.test(sql) &&
    /\b(files|chunks|embedding_cache|chunks_vec|chunks_fts|meta)\b/i.test(sql)
  );
}

function installDestructiveProbe(db: DatabaseSync): { sql: string[] } {
  const captured = { sql: [] as string[] };
  const originalExec = db.exec.bind(db);
  const originalPrepare = db.prepare.bind(db);
  db.exec = ((sql: string) => {
    if (isIndexDataMutationSql(sql)) {
      captured.sql.push(sql);
    }
    return originalExec(sql);
  }) as DatabaseSync["exec"];
  db.prepare = ((sql: string) => {
    const stmt = originalPrepare(sql);
    if (isIndexDataMutationSql(sql)) {
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

function runBarrierChild(params: {
  role: "a" | "b";
  sqlitePath: string;
  workspaceDir: string;
  startFile: string;
  overlapMarker: string;
  onReady: (role: "a" | "b") => void;
}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        CONCURRENT_PROBE,
        params.role,
        params.sqlitePath,
        params.workspaceDir,
        params.startFile,
        params.overlapMarker,
      ],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          OPENBOT_V1_ROOT_GUARD_SECRET: "",
          OPENBOT_V1_ROOT_GUARD_TOKEN: "",
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.includes(`ready:${params.role}`)) {
        params.onReady(params.role);
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

describe("memory manager v1 root guard integration", () => {
  let workspaceDir = "";
  const managers: MemoryIndexManager[] = [];

  beforeEach(async () => {
    resetEmbeddingMocks();
    vi.stubEnv("OPENCLAW_TEST_MEMORY_UNSAFE_REINDEX", "1");
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-v1-guard-int-"));
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "Hello memory zebra.");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(managers.splice(0).map((manager) => manager.close()));
    await closeAllMemoryIndexManagers();
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  async function openManager(params: {
    indexName: string;
    sources?: Array<"memory" | "sessions">;
    agentId?: string;
    agentIds?: string[];
  }): Promise<MemoryIndexManager> {
    const indexPath = path.join(workspaceDir, params.indexName);
    const result = await getMemorySearchManager({
      cfg: createCfg({
        workspaceDir,
        indexPath,
        sources: params.sources,
        agentIds: params.agentIds,
      }),
      agentId: params.agentId ?? "main",
    });
    if (!result.manager) {
      throw new Error("manager missing");
    }
    const manager = result.manager as MemoryIndexManager;
    managers.push(manager);
    return manager;
  }

  it("blocks sessions-only sync before any sqlite write on unregistered db", async () => {
    const current = await openManager({
      indexName: "sessions-only.sqlite",
      sources: ["sessions"],
    });
    const internals = asInternals(current);
    const probe = installDestructiveProbe(internals.db);

    await expect(current.sync({ reason: "session-delta" })).rejects.toSatisfy(isV1RootGuardError);
    expect(probe.sql).toEqual([]);
    expect(current.status().custom?.indexStatus).toBe("unknown");
    expect(current.status().custom?.v1RootGuard).toMatchObject({
      indexStatus: "unknown",
      reason: "unregistered-v1-fail-closed",
    });
  });

  it("runs boundary guard before ensureVectorReady on refused sync", async () => {
    const current = await openManager({ indexName: "main.sqlite" });
    const internals = asInternals(current);
    const ensureSpy = vi.spyOn(internals, "ensureVectorReady");

    await expect(current.sync({ reason: "test" })).rejects.toSatisfy(isV1RootGuardError);
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it("dual-root sidecar rebuild requires grant even after same-root register", async () => {
    const sqlitePath = path.join(workspaceDir, "agent-a.sqlite");
    const current = await openManager({ indexName: "agent-a.sqlite" });
    writeSidecar(`${sqlitePath}.v1-root-guard.json`, {
      fingerprints: [normalizeRootFingerprint(workspaceDir), "/other/workspace-agent-a"],
    });
    writeFingerprintsToDb(asInternals(current).db, [normalizeRootFingerprint(workspaceDir)]);
    const probe = installDestructiveProbe(asInternals(current).db);
    const auditBefore = readMaintenanceUnlockAudit(sqlitePath);
    expect(auditBefore).toEqual([]);

    await expect(current.sync({ force: true })).rejects.toSatisfy((error: unknown) => {
      return isV1RootGuardError(error) && error.decision.reason === "known-conflict-preset-deny";
    });
    expect(probe.sql).toEqual([]);
    expect(readMaintenanceUnlockAudit(sqlitePath)).toEqual([]);
    expect(current.status().custom?.indexStatus).toBe("degraded");
    expect(current.status().custom?.v1RootGuard).toMatchObject({
      indexStatus: "degraded",
      reason: "known-conflict-preset-deny",
      refusedOp: "rebuild",
    });

    const token = signMaintenanceGrant({
      secret: SECRET,
      sqlitePath,
      op: "rebuild",
      reason: "preset-deny-maintenance-unlock",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.stubEnv(V1_GUARD_SECRET_ENV, SECRET);
    vi.stubEnv(V1_GUARD_TOKEN_ENV, token);
    const readEnvSpy = vi.spyOn(v1RootGuard, "readV1RootGuardUnlockFromEnv");

    await expect(current.sync({ force: true })).resolves.toBeUndefined();
    expect(readEnvSpy.mock.calls.length).toBe(1);
    expect(current.status().files).toBeGreaterThan(0);
    const auditAfter = readMaintenanceUnlockAudit(sqlitePath);
    expect(auditAfter).toHaveLength(auditBefore.length + 1);
    expect(auditAfter.at(-1)).toMatchObject({
      action: "maintenance-unlock",
      op: "rebuild",
      reason: "preset-deny-maintenance-unlock",
      tokenVerified: true,
      sqliteInstance: normalizeSqliteInstanceId(sqlitePath),
    });
    readEnvSpy.mockRestore();
  });

  it("concurrent sync attempts on shared sqlite both refuse without mutation", async () => {
    const sharedIndex = path.join(workspaceDir, "shared.sqlite");
    const cfg = createCfg({
      workspaceDir,
      indexPath: sharedIndex,
      agentIds: ["main", "alt"],
    });
    const [first, second] = await Promise.all([
      getMemorySearchManager({ cfg, agentId: "main" }),
      getMemorySearchManager({ cfg, agentId: "alt" }),
    ]);
    if (!first.manager || !second.manager) {
      throw new Error("manager missing");
    }
    const managerA = first.manager as MemoryIndexManager;
    const managerB = second.manager as MemoryIndexManager;
    managers.push(managerA, managerB);
    const probe = installDestructiveProbe(asInternals(managerA).db);

    const results = await Promise.allSettled([
      managerA.sync({ reason: "a" }),
      managerB.sync({ reason: "b" }),
    ]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(probe.sql).toEqual([]);
    expect(managerA.status().custom?.indexStatus).toBe("unknown");
    expect(managerB.status().custom?.indexStatus).toBe("unknown");
  });

  it("barrier-released child processes race guard without mutating reopened sqlite snapshot", async () => {
    const sqlitePath = path.join(workspaceDir, "agent-a.sqlite");
    const current = await openManager({ indexName: "agent-a.sqlite" });
    const internals = asInternals(current);
    writeSidecar(`${sqlitePath}.v1-root-guard.json`, {
      fingerprints: [normalizeRootFingerprint(workspaceDir), "/other/workspace-agent-a"],
    });
    writeFingerprintsToDb(internals.db, [normalizeRootFingerprint(workspaceDir)]);
    seedIndexRows(internals.db);
    const before = snapshotIndexData(internals.db);
    const auditBefore = readMaintenanceUnlockAudit(sqlitePath);

    const startFile = path.join(workspaceDir, "barrier.start");
    const overlapMarker = path.join(workspaceDir, "barrier.overlap");
    await fs.writeFile(overlapMarker, "");

    await current.close();
    const index = managers.indexOf(current);
    if (index >= 0) {
      managers.splice(index, 1);
    }
    await closeAllMemoryIndexManagers();

    const ready = new Set<"a" | "b">();
    let released = false;
    const maybeRelease = async () => {
      if (released || ready.size < 2) {
        return;
      }
      released = true;
      await fs.writeFile(startFile, "go\n");
    };

    const [first, second] = await Promise.all([
      runBarrierChild({
        role: "a",
        sqlitePath,
        workspaceDir,
        startFile,
        overlapMarker,
        onReady: (role) => {
          ready.add(role);
          void maybeRelease();
        },
      }),
      runBarrierChild({
        role: "b",
        sqlitePath,
        workspaceDir,
        startFile,
        overlapMarker,
        onReady: (role) => {
          ready.add(role);
          void maybeRelease();
        },
      }),
    ]);

    expect(first.status, first.stderr || first.stdout).toBe(0);
    expect(second.status, second.stderr || second.stdout).toBe(0);
    expect(first.stdout).toContain("result:refused:known-conflict-preset-deny:a");
    expect(second.stdout).toContain("result:refused:known-conflict-preset-deny:b");
    expect(first.stdout).not.toContain("result:busy:");
    expect(second.stdout).not.toContain("result:busy:");
    expect(first.stdout).not.toContain("result:allowed:");
    expect(second.stdout).not.toContain("result:allowed:");

    const overlap = await fs.readFile(overlapMarker, "utf8");
    expect(overlap).toContain("a:entered");
    expect(overlap).toContain("b:entered");

    const reopened = new DatabaseSync(sqlitePath);
    try {
      expect(snapshotIndexData(reopened)).toEqual(before);
    } finally {
      reopened.close();
    }
    expect(readMaintenanceUnlockAudit(sqlitePath)).toEqual(auditBefore);
  });

  it("second process cannot bypass guard on unregistered shared sqlite", async () => {
    const sqlitePath = path.join(workspaceDir, "shared-process.sqlite");
    const current = await openManager({ indexName: "shared-process.sqlite" });
    const probe = installDestructiveProbe(asInternals(current).db);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CHILD_PROBE, sqlitePath, workspaceDir],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          OPENBOT_V1_ROOT_GUARD_SECRET: "",
          OPENBOT_V1_ROOT_GUARD_TOKEN: "",
        },
        encoding: "utf8",
      },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("refused:unregistered-v1-fail-closed");
    expect(probe.sql).toEqual([]);
  });
});
