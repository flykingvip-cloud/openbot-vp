import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadConfigMock,
  resolvePlatformAuthConfigMock,
  loadPlatformAuthStoreMock,
  findUserByEmailMock,
  findMembershipByUserIdMock,
  resolveAuthorizedAgentToolWorkspaceCwdMock,
  loadExistingGovernedWorkspaceIdentityMock,
} = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  resolvePlatformAuthConfigMock: vi.fn(),
  loadPlatformAuthStoreMock: vi.fn(),
  findUserByEmailMock: vi.fn(),
  findMembershipByUserIdMock: vi.fn(),
  resolveAuthorizedAgentToolWorkspaceCwdMock: vi.fn(),
  loadExistingGovernedWorkspaceIdentityMock: vi.fn(),
}));

vi.mock("../config/config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("./platform-auth.js", () => ({
  resolvePlatformAuthConfig: resolvePlatformAuthConfigMock,
  loadPlatformAuthStore: loadPlatformAuthStoreMock,
  findUserByEmail: findUserByEmailMock,
  findMembershipByUserId: findMembershipByUserIdMock,
}));
vi.mock("./workspace-resolver/tool-cwd.js", () => ({
  resolveAuthorizedAgentToolWorkspaceCwd: resolveAuthorizedAgentToolWorkspaceCwdMock,
  loadExistingGovernedWorkspaceIdentity: loadExistingGovernedWorkspaceIdentityMock,
}));

import type { OpenBotConfig } from "../config/types.js";
import type { GatewayClient } from "./server-methods/types.js";
import { resolveAgentWorkspaceDirForClient, resolveDataRootForClient } from "./tenant-context.js";

function client(partial: Partial<GatewayClient>): GatewayClient {
  return { connect: {} as never, user: "a@acme.com", ...partial } as GatewayClient;
}

describe("managed cwd deny stays on membership workspace", () => {
  const tenantsRoot = path.join(os.tmpdir(), "openbot-tctx-managed-cwd-fallback");
  const managedCfg = { data: { mode: "managed" } } as OpenBotConfig;

  beforeEach(() => {
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_MULTITENANT = "1";
    loadConfigMock.mockReturnValue({
      gateway: { auth: { trustedProxy: {} } },
      data: { mode: "managed" },
    });
    resolvePlatformAuthConfigMock.mockReturnValue({ enabled: true });
    loadPlatformAuthStoreMock.mockResolvedValue({});
    findUserByEmailMock.mockReturnValue({ id: "u1", email: "a@acme.com" });
    findMembershipByUserIdMock.mockReturnValue({ enterpriseId: "acme" });
    resolveAuthorizedAgentToolWorkspaceCwdMock.mockReturnValue({
      ok: false,
      reason: "unwired_catalog",
    });
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.OPENBOT_TENANTS_ROOT;
    delete process.env.OPENBOT_MULTITENANT;
  });

  it("returns the membership workspace instead of throwing agent tool cwd denied", async () => {
    const employeeClient = client({ user: "a@acme.com", sessionDomain: "employee" });
    const workspace = await resolveAgentWorkspaceDirForClient(employeeClient, "main", managedCfg);
    const dataRoot = await resolveDataRootForClient(employeeClient, managedCfg);
    expect(workspace).toBe(path.join(dataRoot, "agents", "main", "workspace"));
    expect(workspace).toContain(`${path.sep}acme${path.sep}`);
    expect(workspace).toContain("u1");
    expect(resolveAuthorizedAgentToolWorkspaceCwdMock).toHaveBeenCalled();
  });

  it("forwards existing Catalog and exact agentAssetId when the loader finds one record", async () => {
    const catalog = { snapshot: () => ({ resources: { "ws:acme:user:u1:asset:asset-1": {} } }) };
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({
      catalog,
      agentAssetId: "asset-1",
    });
    const employeeClient = client({ user: "a@acme.com", sessionDomain: "employee" });
    await resolveAgentWorkspaceDirForClient(employeeClient, "main", managedCfg);
    expect(resolveAuthorizedAgentToolWorkspaceCwdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        catalog,
        agentAssetId: "asset-1",
        agentId: "main",
      }),
    );
  });
});
