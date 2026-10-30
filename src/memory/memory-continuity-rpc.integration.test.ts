import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryGetTool, createMemorySearchTool } from "../agents/tools/memory-tool.js";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import type { OpenBotConfig } from "../config/config.js";
/**
 * Integration: real memory_search / memory_get tool path with continuity authz.
 *
 * Exercises createMemorySearchTool / createMemoryGetTool the same way the
 * memory-core plugin / gateway tools invoke them, with Item7-style TenantContext
 * (governance from call entry), seat/user identity, and group membership.
 *
 * Backend: builtin (default). Does not flip privateMemoryPromote or memory.backend.
 *
 * Import embedding.test-mocks BEFORE memory-tool / manager so vi.mock bindings
 * apply before the import graph caches real embeddings.
 */
import { resetEmbeddingMocks } from "./embedding.test-mocks.js";
import type { MemoryIndexManager as MemoryIndexManagerType } from "./index.js";
import { closeAllMemoryIndexManagers } from "./manager-runtime.js";
import { MemoryIndexManager } from "./manager.js";
import { buildMemorySearchGovernanceFromCallEntry } from "./memory-search-governance.js";
import { getMemorySearchManager } from "./search-manager.js";
import {
  getRequiredMemoryIndexManager,
  registerIsolatedTestV1Root,
} from "./test-manager-helpers.js";

void MemoryIndexManager;

const cleanup: string[] = [];
const envKeys = [
  "OPENBOT_STATE_DIR",
  "OPENBOT_CONFIG_PATH",
  "OPENCLAW_CONFIG_PATH",
  "OPENBOT_TENANTS_ROOT",
  "OPENCLAW_DISABLE_CONFIG_CACHE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

function buildCfg(params: {
  workspaceDir: string;
  indexPath: string;
  collabRoot?: string;
}): OpenBotConfig {
  return {
    agents: {
      defaults: {
        workspace: params.workspaceDir,
        memorySearch: {
          provider: "openai",
          model: "mock-embed",
          store: { path: params.indexPath, vector: { enabled: false } },
          cache: { enabled: false },
          query: { minScore: 0, hybrid: { enabled: true, vectorWeight: 0, textWeight: 1 } },
          sync: { watch: false, onSessionStart: false, onSearch: false },
        },
      },
      list: [{ id: "main", default: true }],
    },
    ...(params.collabRoot ? { collaboration: { defaults: { workspace: params.collabRoot } } } : {}),
  } as OpenBotConfig;
}

async function writeMembers(
  groupDir: string,
  members: Array<{ userId: string; status: string }>,
): Promise<void> {
  await fs.mkdir(groupDir, { recursive: true });
  await fs.writeFile(
    path.join(groupDir, "members.json"),
    JSON.stringify(
      members.map((m, i) => ({
        memberId: `m-${i}`,
        memberKind: "human",
        userId: m.userId,
        governanceRole: "member",
        status: m.status,
        updatedAtMs: Date.now(),
      })),
    ),
    "utf8",
  );
}

async function withIsolatedEnv<T>(
  dirs: { stateDir: string; configPath: string; tenantsRoot?: string },
  run: () => Promise<T>,
): Promise<T> {
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
  }
  process.env.OPENBOT_STATE_DIR = dirs.stateDir;
  process.env.OPENBOT_CONFIG_PATH = dirs.configPath;
  process.env.OPENCLAW_CONFIG_PATH = dirs.configPath;
  process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
  if (dirs.tenantsRoot) {
    process.env.OPENBOT_TENANTS_ROOT = dirs.tenantsRoot;
  } else {
    delete process.env.OPENBOT_TENANTS_ROOT;
  }
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  try {
    return await run();
  } finally {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  }
}

function parseToolDetails<T>(result: { details?: unknown }): T {
  return result.details as T;
}

describe("memory continuity RPC integration (memory_search / memory_get)", () => {
  let managers: MemoryIndexManagerType[] = [];

  beforeEach(() => {
    resetEmbeddingMocks();
    managers = [];
  });

  afterEach(async () => {
    for (const manager of managers) {
      try {
        await manager.close();
      } catch {
        // ignore
      }
    }
    managers = [];
    await closeAllMemoryIndexManagers().catch(() => undefined);
    await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("authorized DM: search/get returns personal marker; other workspace misses", async () => {
    const marker = `DM_RPC_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const aliceHome = await fs.mkdtemp(path.join(os.tmpdir(), "mem-rpc-dm-a-"));
    const bobHome = await fs.mkdtemp(path.join(os.tmpdir(), "mem-rpc-dm-b-"));
    cleanup.push(aliceHome, bobHome);

    const aliceWs = path.join(aliceHome, "workspace");
    const bobWs = path.join(bobHome, "workspace");
    await fs.mkdir(path.join(aliceWs, "memory"), { recursive: true });
    await fs.mkdir(path.join(bobWs, "memory"), { recursive: true });
    const relPath = "memory/continuity-dm-rpc.md";
    await fs.writeFile(path.join(aliceWs, relPath), `# note\n${marker}\n`, "utf8");

    const aliceCfg = buildCfg({
      workspaceDir: aliceWs,
      indexPath: path.join(aliceHome, "index.sqlite"),
    });
    const bobCfg = buildCfg({
      workspaceDir: bobWs,
      indexPath: path.join(bobHome, "index.sqlite"),
    });

    const alice = await getRequiredMemoryIndexManager({ cfg: aliceCfg, agentId: "main" });
    managers.push(alice);
    await alice.sync({ reason: "test", force: true });
    const directHits = await alice.search(marker, { maxResults: 10, minScore: 0 });
    expect(directHits.some((h) => h.path === relPath || h.snippet.includes(marker))).toBe(true);

    const searchTool = createMemorySearchTool({
      config: aliceCfg,
      authenticatedUserId: "user-alice",
      agentSessionKey: "agent:main:dm:user-alice",
    });
    const getTool = createMemoryGetTool({
      config: aliceCfg,
      authenticatedUserId: "user-alice",
      agentSessionKey: "agent:main:dm:user-alice",
    });
    expect(searchTool).not.toBeNull();
    expect(getTool).not.toBeNull();

    const searchResult = await searchTool!.execute("rpc-dm-search", {
      query: marker,
      maxResults: 10,
      minScore: 0,
    });
    const searchDetails = parseToolDetails<{
      results: Array<{ path: string; snippet: string }>;
      disabled?: boolean;
    }>(searchResult);
    expect(searchDetails.disabled).not.toBe(true);
    expect(
      searchDetails.results.some((h) => h.path === relPath || h.snippet.includes(marker)),
    ).toBe(true);
    expect(JSON.stringify(searchDetails)).toContain(marker);

    const getResult = await getTool!.execute("rpc-dm-get", { path: relPath });
    const getDetails = parseToolDetails<{ path: string; text: string; disabled?: boolean }>(
      getResult,
    );
    expect(getDetails.disabled).not.toBe(true);
    expect(getDetails.text).toContain(marker);

    const bob = await getRequiredMemoryIndexManager({ cfg: bobCfg, agentId: "main" });
    managers.push(bob);
    await bob.sync({ reason: "test", force: true });
    const bobSearch = createMemorySearchTool({
      config: bobCfg,
      authenticatedUserId: "user-bob",
      agentSessionKey: "agent:main:dm:user-bob",
    });
    const bobResult = await bobSearch!.execute("rpc-dm-bob", {
      query: marker,
      maxResults: 10,
      minScore: 0,
    });
    const bobDetails = parseToolDetails<{ results: Array<{ snippet: string }> }>(bobResult);
    expect(bobDetails.results.every((h) => !h.snippet.includes(marker))).toBe(true);
  });

  it("authorized group member search/get OK; non-member / revoked / cross-tenant forbidden without body", async () => {
    const marker = `GROUP_RPC_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-rpc-group-state-"));
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-rpc-group-ws-"));
    const tenantsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mem-rpc-tenants-"));
    cleanup.push(stateDir, workspaceDir, tenantsRoot);

    const collabRoot = path.join(stateDir, "collab-workspace");
    const groupId = "rpc-group-1";
    const groupDir = path.join(collabRoot, "groups", encodeURIComponent(groupId));
    await writeMembers(groupDir, [{ userId: "member-alice", status: "active" }]);
    await fs.mkdir(path.join(groupDir, "memory"), { recursive: true });
    await fs.writeFile(
      path.join(groupDir, "memory", "group-note.md"),
      `# group\n${marker}\n`,
      "utf8",
    );
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });

    const crossTenant = "tenant-other";
    const crossMem = path.join(
      tenantsRoot,
      crossTenant,
      "collaboration",
      "groups",
      encodeURIComponent(groupId),
      "memory",
    );
    await fs.mkdir(crossMem, { recursive: true });
    await fs.writeFile(path.join(crossMem, "other.md"), `# CROSS\nCROSS_TENANT_SECRET\n`, "utf8");

    const configPath = path.join(stateDir, "openbot.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          defaults: { workspace: workspaceDir },
          list: [{ id: "main", default: true }],
        },
        collaboration: { defaults: { workspace: collabRoot } },
      }),
      "utf8",
    );

    await withIsolatedEnv({ stateDir, configPath, tenantsRoot }, async () => {
      const cfg = buildCfg({
        workspaceDir,
        indexPath: path.join(stateDir, "index.sqlite"),
        collabRoot,
      });
      const collabRel = `collaboration/${groupId}/memory/group-note.md`;

      const memberAuthzResult = await getMemorySearchManager({
        cfg,
        agentId: "main",
        authenticatedUserId: "member-alice",
      });
      expect(memberAuthzResult.manager).not.toBeNull();
      const memberManager = memberAuthzResult.manager as MemoryIndexManagerType;
      registerIsolatedTestV1Root(memberManager);
      managers.push(memberManager);
      await memberManager.sync({ reason: "test", force: true });
      const memberDirect = await memberManager.search(marker, { maxResults: 10, minScore: 0 });
      expect(
        memberDirect.some(
          (h) => h.path.includes(`collaboration/${groupId}/`) && h.snippet.includes(marker),
        ),
      ).toBe(true);

      const memberSearch = createMemorySearchTool({
        config: cfg,
        authenticatedUserId: "member-alice",
        agentSessionKey: "agent:main:group:rpc-group-1",
      });
      const memberGet = createMemoryGetTool({
        config: cfg,
        authenticatedUserId: "member-alice",
      });
      const memberSearchResult = await memberSearch!.execute("rpc-member-search", {
        query: marker,
        maxResults: 10,
        minScore: 0,
      });
      const memberHits = parseToolDetails<{
        results: Array<{ path: string; snippet: string }>;
      }>(memberSearchResult);
      expect(
        memberHits.results.some(
          (h) => h.path.includes(`collaboration/${groupId}/`) && h.snippet.includes(marker),
        ),
      ).toBe(true);
      const memberGetResult = await memberGet!.execute("rpc-member-get", { path: collabRel });
      const memberGot = parseToolDetails<{ text: string; disabled?: boolean; error?: string }>(
        memberGetResult,
      );
      expect(memberGot.disabled).not.toBe(true);
      expect(memberGot.text).toContain(marker);

      const carolResult = await getMemorySearchManager({
        cfg,
        agentId: "main",
        authenticatedUserId: "non-member-carol",
      });
      expect(carolResult.manager).not.toBeNull();
      const carolManager = carolResult.manager as MemoryIndexManagerType;
      registerIsolatedTestV1Root(carolManager);
      managers.push(carolManager);
      await carolManager.sync({ reason: "test", force: true });

      const nonMemberSearch = createMemorySearchTool({
        config: cfg,
        authenticatedUserId: "non-member-carol",
      });
      const nonMemberGet = createMemoryGetTool({
        config: cfg,
        authenticatedUserId: "non-member-carol",
      });
      const carolSearchResult = await nonMemberSearch!.execute("rpc-carol-search", {
        query: marker,
        maxResults: 10,
        minScore: 0,
      });
      const carolHits = parseToolDetails<{ results: Array<{ snippet: string }> }>(
        carolSearchResult,
      );
      expect(carolHits.results.every((h) => !h.snippet.includes(marker))).toBe(true);
      expect(JSON.stringify(carolHits)).not.toContain(marker);

      const carolGetResult = await nonMemberGet!.execute("rpc-carol-get", { path: collabRel });
      const carolGot = parseToolDetails<{
        text: string;
        disabled?: boolean;
        error?: string;
        reasonCode?: string;
      }>(carolGetResult);
      expect(carolGot.disabled).toBe(true);
      expect(carolGot.text).toBe("");
      expect(carolGot.error).toBe("not authorized");
      expect(carolGot.reasonCode).toBe("non_member");
      expect(JSON.stringify(carolGot)).not.toContain(marker);

      await writeMembers(groupDir, [{ userId: "member-alice", status: "revoked" }]);
      const revokedGet = createMemoryGetTool({
        config: cfg,
        authenticatedUserId: "member-alice",
      });
      const revokedResult = await revokedGet!.execute("rpc-revoked-get", { path: collabRel });
      const revokedGot = parseToolDetails<{
        text: string;
        disabled?: boolean;
        error?: string;
        reasonCode?: string;
      }>(revokedResult);
      expect(revokedGot.disabled).toBe(true);
      expect(revokedGot.text).toBe("");
      expect(revokedGot.error).toBe("not authorized");
      expect(revokedGot.reasonCode).toBe("revoked_or_inactive");
      expect(JSON.stringify(revokedGot)).not.toContain(marker);

      await writeMembers(groupDir, [{ userId: "member-alice", status: "active" }]);

      const governanceOther = buildMemorySearchGovernanceFromCallEntry({
        tenantId: crossTenant,
        userId: "member-alice",
        seatId: "seat-other",
      });
      expect(governanceOther).toBeTruthy();
      const crossGet = createMemoryGetTool({
        config: cfg,
        governance: governanceOther!,
        authenticatedUserId: "member-alice",
      });
      const crossResult = await crossGet!.execute("rpc-cross-get", { path: collabRel });
      const crossGot = parseToolDetails<{
        text: string;
        disabled?: boolean;
        error?: string;
        reasonCode?: string;
      }>(crossResult);
      expect(crossGot.disabled).toBe(true);
      expect(crossGot.text).toBe("");
      expect(crossGot.error).toBe("not authorized");
      expect(["cross_tenant", "non_member", "not_authorized"]).toContain(crossGot.reasonCode);
      expect(JSON.stringify(crossGot)).not.toContain(marker);
      expect(JSON.stringify(crossGot)).not.toContain("CROSS_TENANT_SECRET");

      const crossSearch = createMemorySearchTool({
        config: cfg,
        governance: governanceOther!,
        authenticatedUserId: "member-alice",
      });
      const crossSearchResult = await crossSearch!.execute("rpc-cross-search", {
        query: marker,
        maxResults: 10,
        minScore: 0,
      });
      const crossHits = parseToolDetails<{ results: Array<{ snippet: string }> }>(
        crossSearchResult,
      );
      expect(crossHits.results.every((h) => !h.snippet.includes(marker))).toBe(true);
      expect(JSON.stringify(crossHits)).not.toContain("CROSS_TENANT_SECRET");
    });
  });
});
