/**
 * Builtin collaboration continuity gaps:
 * - watcher must observe authorized memory roots (no per-search full reindex)
 * - same group id across tenants must not share sqlite or snippets
 * - a revoked caller's previous manager must not return body or snippet
 * - no embedding provider is reported as FTS-only, not semantic
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import type { CollaborationMemoryIndexRoot } from "../gateway/collaboration-learning/memory-index-paths.js";
import { closeAllMemoryIndexManagers, type MemoryIndexManager } from "./manager.js";
import { registerIsolatedTestV1Root } from "./test-manager-helpers.js";

vi.mock("./embeddings.js", () => ({
  createEmbeddingProvider: async () => ({
    provider: null,
    requestedProvider: "openai",
    providerUnavailableReason: "missing api key",
  }),
}));

vi.mock("./sqlite-vec.js", () => ({
  loadSqliteVecExtension: async () => ({ ok: false, error: "sqlite-vec disabled in tests" }),
}));

const managers: MemoryIndexManager[] = [];
const cleanups: string[] = [];

function root(groupId: string, memoryDir: string): CollaborationMemoryIndexRoot {
  return {
    groupId,
    memoryDir,
    indexPrefix: `collaboration/${groupId}/memory`,
    sessionKey: `space:${groupId}`,
  };
}

function buildCfg(params: {
  workspaceDir: string;
  indexPath: string;
  watch?: boolean;
}): OpenBotConfig {
  return {
    agents: {
      defaults: {
        workspace: params.workspaceDir,
        memorySearch: {
          provider: "openai",
          model: "mock-embed",
          fallback: "none",
          store: { path: params.indexPath, vector: { enabled: false } },
          cache: { enabled: false },
          query: { minScore: 0, hybrid: { enabled: true, vectorWeight: 0, textWeight: 1 } },
          sync: {
            watch: params.watch ?? false,
            watchDebounceMs: 40,
            onSessionStart: false,
            onSearch: true,
          },
        },
      },
      list: [{ id: "main", default: true }],
    },
  } as OpenBotConfig;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return Date.now() - started;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return -1;
}

describe("builtin collaboration continuity", () => {
  afterEach(async () => {
    await closeAllMemoryIndexManagers();
    managers.splice(0);
    for (const dir of cleanups.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("picks up collaboration add, modify, and delete without an explicit sync", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-watch-ws-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-watch-state-"));
    cleanups.push(workspaceDir, stateDir);
    const memoryDir = path.join(stateDir, "groups", "eng", "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const initial = `INITIAL_${Date.now()}`;
    const added = `ADDED_${Date.now()}`;
    const edited = `EDITED_${Date.now()}`;
    await fs.writeFile(path.join(memoryDir, "initial.md"), `# note\n${initial}\n`, "utf8");

    const { MemoryIndexManager } = await import("./manager.js");
    const manager = await MemoryIndexManager.get({
      cfg: buildCfg({
        workspaceDir,
        indexPath: path.join(stateDir, "index.sqlite"),
        watch: true,
      }),
      agentId: `watch-${Date.now()}`,
      collaborationMemoryRoots: [root("eng", memoryDir)],
      continuityIdentity: { userId: "alice", tenantId: "tenant-a" },
    });
    expect(manager).not.toBeNull();
    registerIsolatedTestV1Root(manager!);
    managers.push(manager!);

    const boundMs = 4_000;
    const initialElapsed = await waitFor(async () => {
      const hits = await manager!.search(initial, { maxResults: 5, minScore: 0 });
      return hits.some((hit) => hit.snippet.includes(initial));
    }, boundMs);
    expect(initialElapsed).toBeGreaterThanOrEqual(0);
    expect(initialElapsed).toBeLessThan(boundMs);

    const addedPath = path.join(memoryDir, "added.md");
    await fs.writeFile(addedPath, `# added\n${added}\n`, "utf8");
    const addElapsed = await waitFor(async () => {
      const hits = await manager!.search(added, { maxResults: 5, minScore: 0 });
      return hits.some((hit) => hit.snippet.includes(added));
    }, boundMs);
    expect(addElapsed).toBeGreaterThanOrEqual(0);
    expect(addElapsed).toBeLessThan(boundMs);

    await fs.writeFile(addedPath, `# edited\n${edited}\n`, "utf8");
    const editElapsed = await waitFor(async () => {
      const hits = await manager!.search(edited, { maxResults: 5, minScore: 0 });
      const stale = await manager!.search(added, { maxResults: 5, minScore: 0 });
      return (
        hits.some((hit) => hit.snippet.includes(edited)) &&
        stale.every((hit) => !hit.snippet.includes(added))
      );
    }, boundMs);
    expect(editElapsed).toBeGreaterThanOrEqual(0);

    await fs.rm(addedPath, { force: true });
    const deleteElapsed = await waitFor(async () => {
      const hits = await manager!.search(edited, { maxResults: 5, minScore: 0 });
      return hits.every((hit) => !hit.snippet.includes(edited));
    }, boundMs);
    expect(deleteElapsed).toBeGreaterThanOrEqual(0);
  });

  it("does not share snippets across tenants that reuse a group id", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-tenant-ws-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-tenant-state-"));
    cleanups.push(workspaceDir, stateDir);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const dirA = path.join(stateDir, "tenant-a", "eng", "memory");
    const dirB = path.join(stateDir, "tenant-b", "eng", "memory");
    await fs.mkdir(dirA, { recursive: true });
    await fs.mkdir(dirB, { recursive: true });
    const markerA = `TENANT_A_${Date.now()}`;
    const markerB = `TENANT_B_${Date.now()}`;
    await fs.writeFile(path.join(dirA, "note.md"), markerA, "utf8");
    await fs.writeFile(path.join(dirB, "note.md"), markerB, "utf8");

    const { MemoryIndexManager } = await import("./manager.js");
    const cfg = buildCfg({
      workspaceDir,
      indexPath: path.join(stateDir, "index.sqlite"),
    });
    const managerA = await MemoryIndexManager.get({
      cfg,
      agentId: "main",
      collaborationMemoryRoots: [root("eng", dirA)],
      continuityIdentity: { userId: "alice", tenantId: "tenant-a" },
    });
    const managerB = await MemoryIndexManager.get({
      cfg,
      agentId: "main",
      collaborationMemoryRoots: [root("eng", dirB)],
      continuityIdentity: { userId: "bob", tenantId: "tenant-b" },
    });
    expect(managerA).not.toBeNull();
    expect(managerB).not.toBeNull();
    expect(managerA).not.toBe(managerB);
    registerIsolatedTestV1Root(managerA!);
    registerIsolatedTestV1Root(managerB!);
    managers.push(managerA!, managerB!);
    expect(managerA!.status().dbPath).not.toBe(managerB!.status().dbPath);

    await managerA!.sync({ reason: "test", force: true });
    await managerB!.sync({ reason: "test", force: true });
    const hitsA = await managerA!.search(markerA, { maxResults: 5, minScore: 0 });
    const hitsB = await managerB!.search(markerB, { maxResults: 5, minScore: 0 });
    const crossA = await managerA!.search(markerB, { maxResults: 5, minScore: 0 });
    const crossB = await managerB!.search(markerA, { maxResults: 5, minScore: 0 });
    expect(hitsA.some((hit) => hit.snippet.includes(markerA))).toBe(true);
    expect(hitsB.some((hit) => hit.snippet.includes(markerB))).toBe(true);
    expect(JSON.stringify(crossA)).not.toContain(markerB);
    expect(JSON.stringify(crossB)).not.toContain(markerA);
  });

  it("revoked caller and the previous manager return no snippet", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-revoke-ws-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-revoke-state-"));
    cleanups.push(workspaceDir, stateDir);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const memoryDir = path.join(stateDir, "groups", "eng", "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    const marker = `REVOKE_${Date.now()}`;
    const relPath = "collaboration/eng/memory/note.md";
    await fs.writeFile(path.join(memoryDir, "note.md"), marker, "utf8");

    const { MemoryIndexManager } = await import("./manager.js");
    const cfg = buildCfg({
      workspaceDir,
      indexPath: path.join(stateDir, "index.sqlite"),
    });
    const identity = { userId: "alice", tenantId: "tenant-a" };
    const before = await MemoryIndexManager.get({
      cfg,
      agentId: "main",
      collaborationMemoryRoots: [root("eng", memoryDir)],
      continuityIdentity: identity,
    });
    expect(before).not.toBeNull();
    registerIsolatedTestV1Root(before!);
    managers.push(before!);
    await before!.sync({ reason: "test", force: true });
    const live = await before!.search(marker, { maxResults: 5, minScore: 0 });
    expect(live.some((hit) => hit.snippet.includes(marker))).toBe(true);

    const after = await MemoryIndexManager.get({
      cfg,
      agentId: "main",
      collaborationMemoryRoots: [],
      continuityIdentity: identity,
    });
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    registerIsolatedTestV1Root(after!);
    managers.push(after!);

    const stale = await before!.search(marker, { maxResults: 5, minScore: 0 });
    expect(stale).toEqual([]);
    expect(JSON.stringify(stale)).not.toContain(marker);
    await expect(before!.readFile({ relPath })).rejects.toThrow(/not authorized/);
    const fresh = await after!.search(marker, { maxResults: 5, minScore: 0 });
    expect(JSON.stringify(fresh)).not.toContain(marker);
  });

  it("reports FTS-only degradation and does not treat a paraphrase as a semantic hit", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-fts-ws-"));
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "collab-fts-state-"));
    cleanups.push(workspaceDir, stateDir);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const memoryDir = path.join(stateDir, "groups", "eng", "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(
      path.join(memoryDir, "note.md"),
      "项目下周一截止。quartz-deadline-token 是内部记号。\n",
      "utf8",
    );

    const { MemoryIndexManager } = await import("./manager.js");
    const manager = await MemoryIndexManager.get({
      cfg: buildCfg({
        workspaceDir,
        indexPath: path.join(stateDir, "index.sqlite"),
      }),
      agentId: `fts-${Date.now()}`,
      collaborationMemoryRoots: [root("eng", memoryDir)],
      continuityIdentity: { userId: "alice", tenantId: "tenant-a" },
    });
    expect(manager).not.toBeNull();
    registerIsolatedTestV1Root(manager!);
    managers.push(manager!);
    await manager!.sync({ reason: "test", force: true });

    const lexical = await manager!.search("quartz-deadline-token", { maxResults: 5, minScore: 0 });
    expect(lexical.some((hit) => hit.snippet.includes("quartz-deadline-token"))).toBe(true);

    const paraphrase = await manager!.search("weekday delivery cutoff", {
      maxResults: 5,
      minScore: 0,
    });
    expect(JSON.stringify(paraphrase)).not.toContain("quartz-deadline-token");
    expect(JSON.stringify(paraphrase)).not.toContain("下周一截止");

    const status = manager!.status();
    expect(status.provider).toBe("none");
    expect(status.custom).toMatchObject({
      searchMode: "fts-only",
      degraded: true,
      degradeReason: "embedding_unavailable",
    });
    expect(status.custom?.searchMode).not.toBe("hybrid");
    expect(status.custom?.searchMode).not.toBe("vector");
  });
});
