import fs from "node:fs/promises";
/**
 * Live HTTP listen harness for memory continuity over POST /tools/invoke.
 *
 * Opens a real loopback socket, mounts the production handleToolsInvokeHttpRequest,
 * and exercises memory_search / memory_get with continuity authz (DM + group
 * member / non-member / revoked / cross-tenant). Auth is **injected identity**
 * at the gateway connect boundary (same `{ ok, user }` shape production trusted
 * sessions provide); tools and memory path are real (builtin backend, embedding
 * mocks). memory-core forwards that user as authenticatedUserId.
 *
 * Column contrast (see docs/design/memory-continuity-acceptance.md):
 * - This file = injected identity (authorizeHttpGatewayConnect mocked).
 * - test/memory-continuity-gateway.e2e.test.ts = real authentication passed
 *   (unmocked token auth in a child gateway process; DM only).
 *
 * Does not flip privateMemoryPromote or memory.backend→qmd.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { resetEmbeddingMocks } from "./embedding.test-mocks.js";
import { closeAllMemoryIndexManagers } from "./manager-runtime.js";
import { buildMemorySearchGovernanceFromCallEntry } from "./memory-search-governance.js";
import { getMemorySearchManager } from "./search-manager.js";
import {
  getRequiredMemoryIndexManager,
  registerIsolatedTestV1Root,
} from "./test-manager-helpers.js";

const TEST_GATEWAY_TOKEN = "mem-cont-gw-token-live-http-001";

const { gatewayAuthResult, resolveEmployeeWorkbenchActorMock } = vi.hoisted(() => ({
  gatewayAuthResult: {
    current: {
      ok: true as const,
      user: undefined as string | undefined,
      method: undefined as
        | "none"
        | "token"
        | "password"
        | "tailscale"
        | "device-token"
        | "trusted-proxy"
        | undefined,
      trustedProxy: undefined as
        | {
            provider: "trusted-proxy";
            user: string;
            domain?: "platform" | "enterprise" | "employee";
            enterpriseId?: string;
            membershipId?: string;
            tenantId?: string;
          }
        | undefined,
    },
  },
  resolveEmployeeWorkbenchActorMock: vi.fn(
    async () =>
      null as null | {
        tenantId: string;
        userId: string;
        currentSeatId: string;
      },
  ),
}));

let cfg: OpenBotConfig = {} as OpenBotConfig;

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => cfg,
  };
});

vi.mock("../gateway/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/auth.js")>();
  return {
    ...actual,
    authorizeHttpGatewayConnect: async () => gatewayAuthResult.current,
    isLocalDirectRequest: () => true,
  };
});

vi.mock("../gateway/employee-workbench-scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/employee-workbench-scope.js")>();
  return {
    ...actual,
    resolveEmployeeWorkbenchActor: (...args: unknown[]) =>
      resolveEmployeeWorkbenchActorMock(...(args as [])),
  };
});

vi.mock("../plugins/config-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plugins/config-state.js")>();
  return {
    ...actual,
    isTestDefaultMemorySlotDisabled: () => false,
  };
});

const { handleToolsInvokeHttpRequest } = await import("../gateway/tools-invoke-http.js");

const cleanup: string[] = [];
let sharedPort = 0;
let sharedServer: ReturnType<typeof createServer> | undefined;

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
          // Force sync on search so HTTP invoke indexes freshly written markers.
          sync: { watch: false, onSessionStart: false, onSearch: true },
        },
      },
      list: [
        {
          id: "main",
          default: true,
          tools: { allow: ["memory_search", "memory_get"] },
        },
      ],
    },
    plugins: {
      enabled: true,
      slots: { memory: "memory-core" },
    },
    gateway: {
      tools: { allow: ["memory_search", "memory_get"] },
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

/** Force-index workspace before HTTP invoke (onSearch sync is fire-and-forget). */
async function syncMemoryIndex(params: {
  workspaceDir: string;
  indexPath: string;
  collabRoot?: string;
  authenticatedUserId?: string;
}): Promise<void> {
  const localCfg = buildCfg(params);
  if (params.authenticatedUserId) {
    const result = await getMemorySearchManager({
      cfg: localCfg,
      agentId: "main",
      authenticatedUserId: params.authenticatedUserId,
    });
    if (!result.manager || typeof result.manager.sync !== "function") {
      throw new Error("syncMemoryIndex: manager missing");
    }
    registerIsolatedTestV1Root(result.manager);
    await result.manager.sync({ reason: "test", force: true });
    return;
  }
  const manager = await getRequiredMemoryIndexManager({ cfg: localCfg, agentId: "main" });
  await manager.sync({ reason: "test", force: true });
}

async function invokeMemoryTool(params: {
  tool: "memory_search" | "memory_get";
  args: Record<string, unknown>;
  sessionKey?: string;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${sharedPort}/tools/invoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TEST_GATEWAY_TOKEN}`,
    },
    body: JSON.stringify({
      tool: params.tool,
      args: params.args,
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

function toolDetails(body: Record<string, unknown>): Record<string, unknown> {
  const result = body.result as { details?: Record<string, unknown> } | undefined;
  return result?.details ?? {};
}

/** Deny responses must not leak marker body or search snippets. */
function assertNoBodyOrSnippetLeak(
  details: Record<string, unknown>,
  secrets: string[],
  label: string,
): void {
  const blob = JSON.stringify(details);
  for (const secret of secrets) {
    expect(blob.includes(secret), `${label} leaked ${secret}: ${blob}`).toBe(false);
  }
  const results = (details.results ?? []) as Array<{ snippet?: string; text?: string }>;
  for (const hit of results) {
    for (const secret of secrets) {
      expect((hit.snippet ?? "").includes(secret), `${label} snippet leak`).toBe(false);
      expect((hit.text ?? "").includes(secret), `${label} text leak`).toBe(false);
    }
  }
  if (details.disabled === true) {
    expect(details.text === "" || details.text == null, `${label} disabled text`).toBe(true);
  }
}

beforeAll(async () => {
  sharedServer = createServer((req, res) => {
    void (async () => {
      const handled = await handleToolsInvokeHttpRequest(req, res, {
        auth: { mode: "token", token: TEST_GATEWAY_TOKEN, allowTailscale: false },
      });
      if (!handled) {
        res.statusCode = 404;
        res.end("not found");
      }
    })().catch((err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve, reject) => {
    sharedServer?.once("error", reject);
    sharedServer?.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = sharedServer.address() as AddressInfo;
  sharedPort = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    sharedServer?.close(() => resolve());
  });
});

beforeEach(() => {
  resetEmbeddingMocks();
  resolveEmployeeWorkbenchActorMock.mockReset();
  resolveEmployeeWorkbenchActorMock.mockResolvedValue(null);
  gatewayAuthResult.current = {
    ok: true,
    user: undefined,
    method: undefined,
    trustedProxy: undefined,
  };
  cfg = {} as OpenBotConfig;
});

afterEach(async () => {
  await closeAllMemoryIndexManagers().catch(() => undefined);
  await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("memory continuity live HTTP /tools/invoke", () => {
  it("authorized DM: write marker → HTTP search/get returns marker", async () => {
    const marker = `DM_HTTP_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "mem-http-dm-"));
    cleanup.push(home);
    const workspaceDir = path.join(home, "workspace");
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    const relPath = "memory/continuity-dm-http.md";
    await fs.writeFile(path.join(workspaceDir, relPath), `# note\n${marker}\n`, "utf8");

    const indexPath = path.join(home, "index.sqlite");
    cfg = buildCfg({
      workspaceDir,
      indexPath,
    });
    await syncMemoryIndex({ workspaceDir, indexPath });
    gatewayAuthResult.current = {
      ok: true,
      user: "user-alice",
      method: "token",
      trustedProxy: undefined,
    };

    const search = await invokeMemoryTool({
      tool: "memory_search",
      args: { query: marker, maxResults: 10, minScore: 0 },
      sessionKey: "agent:main:dm:user-alice",
    });
    expect(search.status).toBe(200);
    expect(search.body.ok).toBe(true);
    const searchDetails = toolDetails(search.body);
    expect(searchDetails.disabled).not.toBe(true);
    const results = (searchDetails.results ?? []) as Array<{ path?: string; snippet?: string }>;
    expect(
      results.some((h) => h.path === relPath || (h.snippet ?? "").includes(marker)),
      `DM search body=${JSON.stringify(search.body)}`,
    ).toBe(true);
    expect(JSON.stringify(searchDetails)).toContain(marker);

    const got = await invokeMemoryTool({
      tool: "memory_get",
      args: { path: relPath },
      sessionKey: "agent:main:dm:user-alice",
    });
    expect(got.status).toBe(200);
    expect(got.body.ok).toBe(true);
    const getDetails = toolDetails(got.body);
    expect(getDetails.disabled).not.toBe(true);
    expect(JSON.stringify(getDetails)).toContain(marker);
  });

  it("authorized group member search/get OK; non-member / revoked / cross-tenant forbidden without leak", async () => {
    const marker = `GROUP_HTTP_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-http-group-"));
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-http-group-ws-"));
    const tenantsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mem-http-tenants-"));
    cleanup.push(stateDir, workspaceDir, tenantsRoot);

    const collabRoot = path.join(stateDir, "collab-workspace");
    const groupId = "http-group-1";
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

    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_STATE_DIR = stateDir;

    const indexPath = path.join(stateDir, "index.sqlite");
    cfg = buildCfg({
      workspaceDir,
      indexPath,
      collabRoot,
    });
    await syncMemoryIndex({
      workspaceDir,
      indexPath,
      collabRoot,
      authenticatedUserId: "member-alice",
    });
    const collabRel = `collaboration/${groupId}/memory/group-note.md`;

    // Authorized member
    gatewayAuthResult.current = {
      ok: true,
      user: "member-alice",
      method: "token",
      trustedProxy: undefined,
    };
    const memberSearch = await invokeMemoryTool({
      tool: "memory_search",
      args: { query: marker, maxResults: 10, minScore: 0 },
      sessionKey: "agent:main:group:http-group-1",
    });
    expect(memberSearch.status).toBe(200);
    expect(memberSearch.body.ok).toBe(true);
    const memberHits = toolDetails(memberSearch.body);
    const memberResults = (memberHits.results ?? []) as Array<{ path?: string; snippet?: string }>;
    expect(
      memberResults.some(
        (h) =>
          (h.path ?? "").includes(`collaboration/${groupId}/`) &&
          (h.snippet ?? "").includes(marker),
      ),
      `group member search body=${JSON.stringify(memberSearch.body)}`,
    ).toBe(true);

    const memberGet = await invokeMemoryTool({
      tool: "memory_get",
      args: { path: collabRel },
    });
    expect(memberGet.status).toBe(200);
    const memberGot = toolDetails(memberGet.body);
    expect(memberGot.disabled).not.toBe(true);
    expect(JSON.stringify(memberGot)).toContain(marker);

    const leakSecrets = [marker, "CROSS_TENANT_SECRET"];

    // Non-member (injected identity: user present, not in members.json)
    gatewayAuthResult.current = {
      ok: true,
      user: "non-member-carol",
      method: "token",
      trustedProxy: undefined,
    };
    const carolSearch = await invokeMemoryTool({
      tool: "memory_search",
      args: { query: marker, maxResults: 10, minScore: 0 },
    });
    expect(carolSearch.status).toBe(200);
    const carolHits = toolDetails(carolSearch.body);
    assertNoBodyOrSnippetLeak(carolHits, leakSecrets, "non-member search");

    const carolGet = await invokeMemoryTool({
      tool: "memory_get",
      args: { path: collabRel },
    });
    expect(carolGet.status).toBe(200);
    const carolGot = toolDetails(carolGet.body);
    expect(carolGot.disabled).toBe(true);
    expect(carolGot.error).toBe("not authorized");
    expect(carolGot.reasonCode).toBe("non_member");
    assertNoBodyOrSnippetLeak(carolGot, leakSecrets, "non-member get");

    // Revoked (same user id, status revoked) — search + get, no leak
    await writeMembers(groupDir, [{ userId: "member-alice", status: "revoked" }]);
    gatewayAuthResult.current = {
      ok: true,
      user: "member-alice",
      method: "token",
      trustedProxy: undefined,
    };
    const revokedSearch = await invokeMemoryTool({
      tool: "memory_search",
      args: { query: marker, maxResults: 10, minScore: 0 },
    });
    expect(revokedSearch.status).toBe(200);
    assertNoBodyOrSnippetLeak(toolDetails(revokedSearch.body), leakSecrets, "revoked search");
    const revokedGet = await invokeMemoryTool({
      tool: "memory_get",
      args: { path: collabRel },
    });
    expect(revokedGet.status).toBe(200);
    const revokedGot = toolDetails(revokedGet.body);
    expect(revokedGot.disabled).toBe(true);
    expect(revokedGot.error).toBe("not authorized");
    expect(revokedGot.reasonCode).toBe("revoked_or_inactive");
    assertNoBodyOrSnippetLeak(revokedGot, leakSecrets, "revoked get");

    // Cross-tenant (injected identity + explicit managed session domain):
    // #156 B3 — tenant alone does not imply managed; pin enterprise domain so
    // memory-core forwards securityProfile=managed_enterprise, and workbench
    // actor supplies other-tenant governance (same shape as a pinned employee
    // session whose tenant does not own the personal collab group root).
    await writeMembers(groupDir, [{ userId: "member-alice", status: "active" }]);
    gatewayAuthResult.current = {
      ok: true,
      user: "member-alice",
      method: "trusted-proxy",
      trustedProxy: {
        provider: "trusted-proxy",
        user: "member-alice",
        domain: "enterprise",
        // createExecutionIdentityFromGatewayAuth reads enterpriseId (not tenantId).
        enterpriseId: crossTenant,
        membershipId: "seat-other",
      },
    } as typeof gatewayAuthResult.current;
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      tenantId: crossTenant,
      userId: "member-alice",
      currentSeatId: "seat-other",
    });
    // Sanity: governance builder produces tenant-scoped proof
    expect(
      buildMemorySearchGovernanceFromCallEntry({
        tenantId: crossTenant,
        userId: "member-alice",
        seatId: "seat-other",
      }),
    ).toBeTruthy();

    const crossSearch = await invokeMemoryTool({
      tool: "memory_search",
      args: { query: marker, maxResults: 10, minScore: 0 },
    });
    expect(crossSearch.status).toBe(200);
    assertNoBodyOrSnippetLeak(toolDetails(crossSearch.body), leakSecrets, "cross-tenant search");

    const crossGet = await invokeMemoryTool({
      tool: "memory_get",
      args: { path: collabRel },
    });
    expect(crossGet.status).toBe(200);
    const crossGot = toolDetails(crossGet.body);
    expect(crossGot.disabled).toBe(true);
    expect(crossGot.error).toBe("not authorized");
    expect(["cross_tenant", "non_member", "not_authorized"]).toContain(
      typeof crossGot.reasonCode === "string" ? crossGot.reasonCode : "not_authorized",
    );
    assertNoBodyOrSnippetLeak(crossGot, leakSecrets, "cross-tenant get");

    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_STATE_DIR;
  });
});
