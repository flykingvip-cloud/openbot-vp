/**
 * Fail-before / pass-after negative evidence for Codex Changes-required items:
 * 1) Managed Resolver miss must not fall back to legacy workspace paths
 * 2) Managed agents.workspace.browse must be denied
 * 3) Non-members must not receive group tool cwd
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  profile: "managed_enterprise" as "personal_local" | "managed_enterprise",
  tenantId: "t-a" as string | null,
  agentLocator: "",
}));

vi.mock("../security-profile.js", () => ({
  resolveSecurityProfile: () => ({
    ok: true,
    profile: state.profile,
    isolationLevel: state.profile === "managed_enterprise" ? "I3" : "I1",
    source: "env",
    tenantExecutionBoundary: state.profile === "managed_enterprise" ? "dedicated" : "unset",
    errors: [],
  }),
}));

vi.mock("../tenant-context.js", () => ({
  resolveTenantContextForSessionStore: async () =>
    state.tenantId ? { tenantId: state.tenantId, userId: "user-a" } : null,
  resolveAgentWorkspaceDirForClient: async () => state.agentLocator,
}));

vi.mock("../../config/data-space.js", () => ({
  isSharedTenantAddressingEnabled: () => state.profile === "managed_enterprise",
  resolveDataMode: () => (state.profile === "managed_enterprise" ? "shared" : "local"),
}));

vi.mock("../agent-registry/store.js", () => ({
  loadAgentRegistryStore: async () => ({
    version: 1,
    assets: {},
    deployments: {},
    revisions: {},
    ownerBindings: {},
    quarantine: {},
  }),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
  writeConfigFile: async () => {},
}));

vi.mock("../server-methods/agents-handler-workspace-locator.js", () => ({
  resolveAgentsHandlerWorkspaceLocator: async () => {
    if (!state.agentLocator) {
      return {
        ok: false,
        reasonCode: "missing_tenant_context",
        failClosed: true,
        item7: "not-met",
        liveWriteWatchIndex: 36,
        retiredThisChange: 1,
        deleteCallSites: false,
        wiredToProductionResolver: false,
        productionCatalogWrite: "none",
        schemaV2Write: "disabled",
        live: "forbidden",
        phase1bExecutionBlocked: true,
        phase1bUnlock: "not-issued",
        deployAuthorized: false,
      };
    }
    const handle = {
      resourceId: "ws:t-a:user:user-a:asset:asset-main",
      agentAssetId: "asset-main",
      bindingId: "bind-main",
      locator: state.agentLocator,
      tenantId: "t-a",
    };
    return { ok: true, handle, locator: handle };
  },
  resolveAgentsHandlerWorkspaceLocatorOrRespond: async () => state.agentLocator || null,
}));

const {
  resolveAuthorizedGroupToolCwd,
  resolveAuthorizedToolCwd,
  resolveWorkspaceDirAfterAuthorization,
} = await import("./handler-bridge.js");
const { agentsHandlers } = await import("../server-methods/agents.js");

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("managed fail-closed cwd fallback", () => {
  it("denies legacy fallback when managed authorization is empty", () => {
    const legacy = "/legacy/agent/workspace";
    expect(
      resolveWorkspaceDirAfterAuthorization({
        profile: "managed_enterprise",
        authorizedCwd: null,
        personalFallback: () => legacy,
      }),
    ).toBeNull();
  });

  it("never invokes personalFallback for managed_enterprise", () => {
    const resolved = resolveWorkspaceDirAfterAuthorization({
      profile: "managed_enterprise",
      authorizedCwd: null,
      personalFallback: () => {
        throw new Error("legacy personalFallback invoked");
      },
    });
    expect(resolved).toBeNull();
  });

  it("allows personal_local fallback after resolver miss", () => {
    const legacy = "/legacy/agent/workspace";
    expect(
      resolveWorkspaceDirAfterAuthorization({
        profile: "personal_local",
        authorizedCwd: null,
        personalFallback: () => legacy,
      }),
    ).toBe(legacy);
  });

  it("fail-closes group tool cwd when the ChatTurn tenant is missing", async () => {
    state.profile = "managed_enterprise";
    state.tenantId = null;
    await expect(
      resolveAuthorizedGroupToolCwd({
        client: {} as never,
        cfg: {},
        userId: "user-a",
        groupId: "g1",
        purpose: "test.group.cwd",
        authoritativeTenantId: null,
      }),
    ).resolves.toBeNull();
  });

  it("returns authorized cwd when present in managed mode", () => {
    expect(
      resolveWorkspaceDirAfterAuthorization({
        profile: "managed_enterprise",
        authorizedCwd: "/tenants/t-a/workspace",
        personalFallback: () => "/legacy",
      }),
    ).toBe("/tenants/t-a/workspace");
  });
});

describe("managed agents.workspace.browse denial", () => {
  beforeEach(() => {
    state.profile = "managed_enterprise";
  });

  it("rejects arbitrary host-path browse in managed enterprise", async () => {
    let result: { ok: boolean; error?: { message?: string } } = { ok: true };
    await agentsHandlers["agents.workspace.browse"]({
      req: {} as never,
      params: { path: "/tmp" },
      client: {} as never,
      isWebchatConnect: () => false,
      respond: ((ok: boolean, _payload?: unknown, error?: { message?: string }) => {
        result = { ok, error };
      }) as never,
      context: {} as never,
    });
    expect(result.ok).toBe(false);
    expect(String(result.error?.message ?? "")).toMatch(/disabled in managed enterprise/i);
  });

  it("still allows browse in personal_local", async () => {
    state.profile = "personal_local";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "browse-personal-"));
    tempDirs.push(root);
    fs.mkdirSync(path.join(root, "child"), { recursive: true });
    let result: { ok: boolean; payload?: { currentPath?: string } } = { ok: false };
    await agentsHandlers["agents.workspace.browse"]({
      req: {} as never,
      params: { path: root },
      client: {} as never,
      isWebchatConnect: () => false,
      respond: ((ok: boolean, payload?: unknown) => {
        result = { ok, payload: payload as { currentPath?: string } };
      }) as never,
      context: {} as never,
    });
    expect(result.ok).toBe(true);
    expect(result.payload?.currentPath).toBeTruthy();
  });
});

describe("group tool cwd membership gate", () => {
  beforeEach(() => {
    state.profile = "managed_enterprise";
    state.tenantId = "t-a";
  });

  it("denies group tool cwd for non-members even when agent workspace authorizes", async () => {
    const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-agent-"));
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-tenants-"));
    tempDirs.push(agentRoot, tenantsRoot);
    state.agentLocator = agentRoot;
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const membersPath = path.join(
        tenantsRoot,
        "t-a",
        "collaboration",
        "groups",
        encodeURIComponent("g1"),
        "members.json",
      );
      fs.mkdirSync(path.dirname(membersPath), { recursive: true });
      // Only other-user is a member — user-a must not get group cwd.
      fs.writeFileSync(
        membersPath,
        JSON.stringify([
          {
            memberId: "m1",
            memberKind: "human",
            userId: "other-user",
            governanceRole: "owner",
            status: "active",
            updatedAtMs: 1,
          },
        ]),
      );

      const cwd = await resolveAuthorizedToolCwd({
        client: {} as never,
        cfg: {},
        userId: "user-a",
        agentId: "main",
        purpose: "test.group.cwd",
        stewardException: true,
        stewardWorkspaceDir: agentRoot,
        groupId: "g1",
        authoritativeTenantId: "t-a",
      });
      expect(cwd).toBeNull();
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });

  it("grants group tool cwd for active members after catalog/resolver auth", async () => {
    const agentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-agent-ok-"));
    const tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cwd-tenants-ok-"));
    tempDirs.push(agentRoot, tenantsRoot);
    state.agentLocator = agentRoot;
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const groupLocator = path.join(
        tenantsRoot,
        "t-a",
        "collaboration",
        "groups",
        encodeURIComponent("g1"),
      );
      fs.mkdirSync(groupLocator, { recursive: true });
      fs.writeFileSync(
        path.join(groupLocator, "members.json"),
        JSON.stringify([
          {
            memberId: "m1",
            memberKind: "human",
            userId: "user-a",
            governanceRole: "member",
            status: "active",
            updatedAtMs: 1,
          },
        ]),
      );

      const cwd = await resolveAuthorizedToolCwd({
        client: {} as never,
        cfg: {},
        userId: "user-a",
        agentId: "main",
        purpose: "test.group.cwd",
        stewardException: true,
        stewardWorkspaceDir: agentRoot,
        groupId: "g1",
        authoritativeTenantId: "t-a",
      });
      expect(cwd).toBe(fs.realpathSync(groupLocator));
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });
});
