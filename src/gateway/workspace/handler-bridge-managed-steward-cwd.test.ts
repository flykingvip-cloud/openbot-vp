import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEmployeeBuiltinStewardWorkspaceDir } from "../../agents/builtin-steward/employee-isolation.js";
import type { WorkspaceLocatorQueryAttempt } from "../workspace-resolver/strict-locator.js";

const resolveTenantContextMock = vi.hoisted(() => vi.fn());
const resolveWorkspaceLocatorMock = vi.hoisted(() => vi.fn());
const resolveAgentsHandlerWorkspaceLocatorMock = vi.hoisted(() => vi.fn());
const realResolveWorkspaceLocator = vi.hoisted(() => ({
  fn: null as null | ((attempt: WorkspaceLocatorQueryAttempt) => unknown),
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

vi.mock("../tenant-context.js", () => ({
  resolveTenantContextForSessionStore: resolveTenantContextMock,
  resolveTenantContext: resolveTenantContextMock,
  resolveAgentWorkspaceDirForClient: async () => "/tmp/unused",
  resolveControlPlaneStorePathForTenantId: () => undefined,
  resolveControlPlaneStorePathForClient: async () => undefined,
}));

vi.mock("../../config/data-space.js", () => ({
  isSharedTenantAddressingEnabled: () => true,
  resolveDataMode: () => "managed",
  isManagedDataMode: () => true,
}));

vi.mock("../workspace-resolver/strict-locator.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../workspace-resolver/strict-locator.js")>();
  realResolveWorkspaceLocator.fn = orig.resolveWorkspaceLocator;
  resolveWorkspaceLocatorMock.mockImplementation((attempt: WorkspaceLocatorQueryAttempt) =>
    orig.resolveWorkspaceLocator(attempt),
  );
  return {
    ...orig,
    resolveWorkspaceLocator: (attempt: WorkspaceLocatorQueryAttempt) =>
      resolveWorkspaceLocatorMock(attempt),
  };
});

vi.mock("../server-methods/agents-handler-workspace-locator.js", () => ({
  resolveAgentsHandlerWorkspaceLocator: (...args: unknown[]) =>
    resolveAgentsHandlerWorkspaceLocatorMock(...args),
  resolveAgentsHandlerWorkspaceLocatorOrRespond: vi.fn(),
}));

const { resolveWorkspaceLocator } = await import("../workspace-resolver/strict-locator.js");
const {
  resolveAuthorizedToolCwd,
  resolveTrustedAgentLocator,
  resolveWorkspaceDirAfterAuthorization,
} = await import("./handler-bridge.js");

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  resolveTenantContextMock.mockReset();
  resolveWorkspaceLocatorMock.mockReset();
  resolveAgentsHandlerWorkspaceLocatorMock.mockReset();
  resolveWorkspaceLocatorMock.mockImplementation((attempt: WorkspaceLocatorQueryAttempt) => {
    if (!realResolveWorkspaceLocator.fn) {
      throw new Error("real resolveWorkspaceLocator not captured");
    }
    return realResolveWorkspaceLocator.fn(attempt);
  });
  // Default: incomplete trusted query → missing_tenant_context (fail-closed).
  resolveAgentsHandlerWorkspaceLocatorMock.mockResolvedValue({
    ok: false as const,
    reasonCode: "missing_tenant_context",
    failClosed: true as const,
    item7: "not-met" as const,
    liveWriteWatchIndex: 36 as const,
    retiredThisChange: 1 as const,
    deleteCallSites: false as const,
    wiredToProductionResolver: false as const,
    productionCatalogWrite: "none" as const,
    schemaV2Write: "disabled" as const,
    live: "forbidden" as const,
    phase1bExecutionBlocked: true as const,
    phase1bUnlock: "not-issued" as const,
    deployAuthorized: false as const,
  });
});

const managedCfg = { data: { mode: "managed" as const } };

function mockHandleLocator(locator: string) {
  const handle = {
    resourceId: "ws:ent-456:user:usr-steward-owner:asset:asset-alpha",
    agentAssetId: "asset-alpha",
    bindingId: "bind-1",
    locator,
    tenantId: "ent-456",
  };
  resolveAgentsHandlerWorkspaceLocatorMock.mockResolvedValue({
    ok: true as const,
    handle,
    locator: handle,
  });
}

describe("Managed steward cwd Handle vs helper split", () => {
  it("old {cfg}-only locator still deny-closes with missing_tenant_context", () => {
    expect(resolveWorkspaceLocator({ cfg: managedCfg })).toMatchObject({
      ok: false,
      reasonCode: "missing_tenant_context",
      failClosed: true,
    });
  });

  it("resolveTrustedAgentLocator rejects when trusted builder returns missing_tenant_context", async () => {
    await expect(
      resolveTrustedAgentLocator({
        client: null,
        agentId: "main",
        cfg: managedCfg,
      }),
    ).rejects.toThrow(/missing_tenant_context/);
  });

  it("managed steward: helper is not production cwd when Handle locator rejects", async () => {
    const owner = "usr-steward-owner";
    const helper = resolveEmployeeBuiltinStewardWorkspaceDir(owner, {
      stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "hb-steward-state-")),
    });
    tempDirs.push(path.dirname(path.dirname(path.dirname(helper))));
    fs.mkdirSync(helper, { recursive: true });

    resolveTenantContextMock.mockResolvedValue({
      tenantId: "ent-456",
      userId: owner,
      domain: "employee",
    });

    const authorized = await resolveAuthorizedToolCwd({
      client: {
        user: "owner@acme.com",
        sessionDomain: "employee",
        platformUserId: owner,
      } as never,
      cfg: managedCfg,
      userId: owner,
      agentId: "main",
      purpose: "chat.tool.cwd",
      stewardException: true,
      stewardWorkspaceDir: helper,
    });

    expect(authorized).toBeNull();
    expect(authorized).not.toBe(fs.realpathSync(helper));

    const workspaceDirRaw = resolveWorkspaceDirAfterAuthorization({
      profile: "managed_enterprise",
      authorizedCwd: authorized,
      personalFallback: () => helper,
    });
    expect(workspaceDirRaw).toBeNull();
    expect(workspaceDirRaw).not.toBe(fs.realpathSync(helper));
  });

  it("managed steward: production cwd is Handle path, not helper", async () => {
    const owner = "usr-steward-owner";
    const helper = resolveEmployeeBuiltinStewardWorkspaceDir(owner, {
      stateDir: fs.mkdtempSync(path.join(os.tmpdir(), "hb-steward-handle-")),
    });
    const handleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-handle-cwd-"));
    tempDirs.push(path.dirname(path.dirname(path.dirname(helper))), handleRoot);
    fs.mkdirSync(helper, { recursive: true });

    resolveTenantContextMock.mockResolvedValue({
      tenantId: "ent-456",
      userId: owner,
      domain: "employee",
    });
    mockHandleLocator(handleRoot);

    const authorized = await resolveAuthorizedToolCwd({
      client: {
        user: "owner@acme.com",
        sessionDomain: "employee",
        platformUserId: owner,
      } as never,
      cfg: managedCfg,
      userId: owner,
      agentId: "main",
      purpose: "chat.tool.cwd",
      stewardException: true,
      stewardWorkspaceDir: helper,
    });

    expect(authorized).toBe(fs.realpathSync(handleRoot));
    expect(authorized).not.toBe(fs.realpathSync(helper));

    const workspaceDirRaw = resolveWorkspaceDirAfterAuthorization({
      profile: "managed_enterprise",
      authorizedCwd: authorized,
      personalFallback: () => helper,
    });
    expect(workspaceDirRaw).toBe(fs.realpathSync(handleRoot));
    expect(workspaceDirRaw).not.toBe(fs.realpathSync(helper));
  });

  it("managed steward: true missing tenant still fail-closed", async () => {
    const owner = "usr-missing-tenant";
    const helper = path.join(os.tmpdir(), `hb-steward-missing-${owner}`);
    const handleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hb-handle-missing-tenant-"));
    tempDirs.push(helper, handleRoot);
    fs.mkdirSync(helper, { recursive: true });
    resolveTenantContextMock.mockResolvedValue(null);
    mockHandleLocator(handleRoot);

    const authorized = await resolveAuthorizedToolCwd({
      client: null,
      cfg: managedCfg,
      userId: owner,
      agentId: "main",
      purpose: "chat.tool.cwd",
      stewardException: true,
      stewardWorkspaceDir: helper,
    });
    expect(authorized).toBeNull();
    expect(authorized).not.toBe(fs.realpathSync(helper));
    expect(authorized).not.toBe(fs.realpathSync(handleRoot));
    expect(
      resolveWorkspaceDirAfterAuthorization({
        profile: "managed_enterprise",
        authorizedCwd: authorized,
        personalFallback: () => helper,
      }),
    ).toBeNull();
  });

  it("managed steward: missing stewardWorkspaceDir fail-closes without calling helper", async () => {
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "ent-456",
      userId: "usr-steward-owner",
      domain: "employee",
    });

    const authorized = await resolveAuthorizedToolCwd({
      client: {
        user: "owner@acme.com",
        sessionDomain: "employee",
        platformUserId: "usr-steward-owner",
      } as never,
      cfg: managedCfg,
      userId: "usr-steward-owner",
      agentId: "main",
      purpose: "chat.tool.cwd",
      stewardException: true,
    });
    expect(authorized).toBeNull();
    expect(resolveAgentsHandlerWorkspaceLocatorMock).not.toHaveBeenCalled();
  });

  it("managed non-steward still fail-closes when trusted locator rejects", async () => {
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "ent-456",
      userId: "usr-123",
      domain: "employee",
    });
    const authorized = await resolveAuthorizedToolCwd({
      client: {
        user: "u@acme.com",
        sessionDomain: "employee",
        platformUserId: "usr-123",
      } as never,
      cfg: managedCfg,
      userId: "usr-123",
      agentId: "main",
      purpose: "chat.tool.cwd",
      stewardException: false,
    });
    expect(authorized).toBeNull();
  });
});
