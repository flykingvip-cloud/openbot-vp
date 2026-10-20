import { expect, vi, type Mock } from "vitest";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import {
  buildGroupWorkspaceCatalogEntry,
  buildUserOwnedWorkspaceCatalogEntry,
} from "../workspace-resolver/builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";

export const CANONICAL_LOCATOR = "/tmp/openbot-item7-cr-locator/asset-alpha";
export const CWD = process.cwd();

type CrMocks = {
  resolveTenantContext: Mock;
  resolveEmployeeWorkbenchActor: Mock;
  loadExistingGovernedWorkspaceIdentity: Mock;
  ensureGovernedWorkspaceCatalogIdentity: Mock;
  mkdir: Mock;
  appendFile: Mock;
  access: Mock;
  writeConfigFile: Mock;
  writeFileWithinRoot: Mock;
  readLocalFileSafely: Mock;
  movePathToTrash: Mock;
  decommissionRobotWorkspace: Mock;
  pruneAgentConfig: Mock;
  applyAgentMemoryDisposal: Mock;
  authorizeAgentWorkspaceFileAccess: Mock;
  resolveKnowledgeSourceContext: Mock;
  applyAgentConfig: Mock;
  ensureAgentWorkspace: Mock;
  resolvePlatformAuthConfig: Mock;
  loadPlatformAuthStore: Mock;
  loadSeatAssetsStoreForTenantId: Mock;
  loadAuthoritativeGroupMembers: Mock;
  findActiveOwnershipRecord: Mock;
};

const mocks: CrMocks = vi.hoisted(() => ({
  resolveTenantContext: vi.fn(), // used via ForSessionStore mock alias below
  resolveEmployeeWorkbenchActor: vi.fn(),
  loadExistingGovernedWorkspaceIdentity: vi.fn(),
  ensureGovernedWorkspaceCatalogIdentity: vi.fn(async () => ({})),
  mkdir: vi.fn(),
  appendFile: vi.fn(),
  access: vi.fn(),
  writeConfigFile: vi.fn(),
  writeFileWithinRoot: vi.fn(),
  readLocalFileSafely: vi.fn(),
  movePathToTrash: vi.fn(),
  decommissionRobotWorkspace: vi.fn(),
  pruneAgentConfig: vi.fn(),
  applyAgentMemoryDisposal: vi.fn(),
  authorizeAgentWorkspaceFileAccess: vi.fn(),
  resolveKnowledgeSourceContext: vi.fn(),
  applyAgentConfig: vi.fn(),
  ensureAgentWorkspace: vi.fn(),
  resolvePlatformAuthConfig: vi.fn(),
  loadPlatformAuthStore: vi.fn(),
  loadSeatAssetsStoreForTenantId: vi.fn(),
  loadAuthoritativeGroupMembers: vi.fn(),
  findActiveOwnershipRecord: vi.fn(),
}));

vi.mock("../tenant-context.js", () => ({
  resolveTenantContextForSessionStore: (...args: unknown[]) => mocks.resolveTenantContext(...args),
  resolveTenantContext: (...args: unknown[]) => mocks.resolveTenantContext(...args),
  resolveAgentWorkspaceDirForClient: async () => CANONICAL_LOCATOR,
  resolveControlPlaneStorePathForTenantId: () => undefined,
  resolveControlPlaneStorePathForClient: async () => undefined,
}));

vi.mock("../employee-workbench-scope.js", async () => {
  const actual = await vi.importActual<typeof import("../employee-workbench-scope.js")>(
    "../employee-workbench-scope.js",
  );
  return {
    ...actual,
    resolveEmployeeWorkbenchActor: (...args: unknown[]) =>
      mocks.resolveEmployeeWorkbenchActor(...args),
    requiresEmployeeAssetScope: () => false,
    isAgentOwnedByEmployeeUser: () => true,
  };
});

vi.mock("../data-governance/workspace-catalog-projection.js", () => ({
  loadExistingGovernedWorkspaceIdentity: (...args: unknown[]) =>
    mocks.loadExistingGovernedWorkspaceIdentity(...args),
  ensureGovernedWorkspaceCatalogIdentity: (...args: unknown[]) =>
    mocks.ensureGovernedWorkspaceCatalogIdentity(...args),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: (...args: unknown[]) => mocks.mkdir(...args),
    appendFile: (...args: unknown[]) => mocks.appendFile(...args),
    access: (...args: unknown[]) => mocks.access(...args),
  };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    data: { mode: "managed" },
    agents: { list: [{ id: "research" }, { id: "main" }] },
  }),
  writeConfigFile: (...args: unknown[]) => mocks.writeConfigFile(...args),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["research", "main"],
  resolveAgentDir: () => "/tmp/agent-dir",
  resolveAgentWorkspaceDir: () => "/tmp/host-workspace",
  listAgentEntries: () => [{ id: "research" }, { id: "main" }],
  resolveAgentConfig: () => undefined,
}));

vi.mock("../../commands/agents.config.js", async () => {
  const actual = await vi.importActual<typeof import("../../commands/agents.config.js")>(
    "../../commands/agents.config.js",
  );
  return {
    ...actual,
    applyAgentConfig: (...args: unknown[]) => mocks.applyAgentConfig(...args),
    pruneAgentConfig: (...args: unknown[]) => mocks.pruneAgentConfig(...args),
    listAgentEntries: () => [{ id: "research" }, { id: "main" }],
    findAgentEntryIndex: () => 0,
  };
});

vi.mock("../../agents/workspace.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/workspace.js")>(
    "../../agents/workspace.js",
  );
  return {
    ...actual,
    ensureAgentWorkspace: (...args: unknown[]) => mocks.ensureAgentWorkspace(...args),
  };
});

vi.mock("../../infra/fs-safe.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../infra/fs-safe.js")>("../../infra/fs-safe.js");
  return {
    ...actual,
    writeFileWithinRoot: (...args: unknown[]) => mocks.writeFileWithinRoot(...args),
    readLocalFileSafely: (...args: unknown[]) => mocks.readLocalFileSafely(...args),
  };
});

vi.mock("../../browser/trash.js", () => ({
  movePathToTrash: (...args: unknown[]) => mocks.movePathToTrash(...args),
}));

vi.mock("../../workspaces/store.js", () => ({
  decommissionRobotWorkspace: (...args: unknown[]) => mocks.decommissionRobotWorkspace(...args),
}));

vi.mock("../../data/memory-lifecycle.js", () => ({
  applyAgentMemoryDisposal: (...args: unknown[]) => mocks.applyAgentMemoryDisposal(...args),
}));

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: (...args: unknown[]) =>
    mocks.resolveKnowledgeSourceContext(...args),
}));

vi.mock("../workspace/handler-bridge.js", async () => {
  const actual = await vi.importActual<typeof import("../workspace/handler-bridge.js")>(
    "../workspace/handler-bridge.js",
  );
  return {
    ...actual,
    authorizeAgentWorkspaceFileAccess: (...args: unknown[]) =>
      mocks.authorizeAgentWorkspaceFileAccess(...args),
  };
});

vi.mock("../platform-auth.js", async () => {
  const actual = await vi.importActual<typeof import("../platform-auth.js")>("../platform-auth.js");
  return {
    ...actual,
    resolvePlatformAuthConfig: (...args: unknown[]) => mocks.resolvePlatformAuthConfig(...args),
    loadPlatformAuthStore: (...args: unknown[]) => mocks.loadPlatformAuthStore(...args),
  };
});

vi.mock("../platform-auth/seat-store-loader.js", async () => {
  const actual = await vi.importActual<typeof import("../platform-auth/seat-store-loader.js")>(
    "../platform-auth/seat-store-loader.js",
  );
  return {
    ...actual,
    loadSeatAssetsStoreForTenantId: (...args: unknown[]) =>
      mocks.loadSeatAssetsStoreForTenantId(...args),
  };
});

vi.mock("../ownership-store.js", async () => {
  const actual =
    await vi.importActual<typeof import("../ownership-store.js")>("../ownership-store.js");
  return {
    ...actual,
    findActiveOwnershipRecord: (...args: unknown[]) => mocks.findActiveOwnershipRecord(...args),
  };
});

vi.mock("../workspace/group-acl.js", async () => {
  const actual = await vi.importActual<typeof import("../workspace/group-acl.js")>(
    "../workspace/group-acl.js",
  );
  return {
    ...actual,
    loadAuthoritativeGroupMembers: (...args: unknown[]) =>
      mocks.loadAuthoritativeGroupMembers(...args),
  };
});

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: () => ({
    agents: [{ id: "research", name: "Research", ownerId: "user-elle" }],
  }),
}));

vi.mock("../protocol/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../protocol/index.js")>("../protocol/index.js");
  return {
    ...actual,
    validateAgentsFilesGetParams: Object.assign(() => true, { errors: null }),
    validateAgentsFilesSetParams: Object.assign(() => true, { errors: null }),
    validateAgentsUpdateParams: Object.assign(() => true, { errors: null }),
    validateAgentsDeleteParams: Object.assign(() => true, { errors: null }),
  };
});

export function completeCatalog(overrides?: { tenantId?: string; userId?: string }) {
  const tenantId = overrides?.tenantId ?? "tenant-a";
  const userId = overrides?.userId ?? "user-elle";
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId,
    userId,
    agentAssetId: "asset-alpha",
    workspaceRoot: CANONICAL_LOCATOR,
  });
  return {
    entry,
    catalog: new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: { [entry.resource.resourceId]: entry.resource },
      bindings: { [entry.binding.bindingId]: entry.binding },
    }),
  };
}

export function positionOwnedCatalog(overrides?: {
  tenantId?: string;
  seatId?: string;
  agentAssetId?: string;
}) {
  const tenantId = overrides?.tenantId ?? "tenant-a";
  const seatId = overrides?.seatId ?? "seat-sales";
  const agentAssetId = overrides?.agentAssetId ?? "asset-alpha";
  const resourceId = `ws:${tenantId}:seat:${seatId}:asset:${agentAssetId}`;
  const resource = {
    resourceId,
    resourceType: "workspace" as const,
    tenantId,
    ownerScope: {
      kind: "position_owned" as const,
      seatId,
      agentAssetId,
    },
    lifecycleState: "active" as const,
    classification: "agent.workspace",
    governanceVersion: 1,
  };
  const binding = {
    bindingId: `${resourceId}:canonical`,
    resourceId,
    role: "canonical" as const,
    locator: CANONICAL_LOCATOR,
    state: "active" as const,
    contentVersion: "v1",
  };
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: { [resourceId]: resource },
    bindings: { [binding.bindingId]: binding },
  });
}

export function groupOwnedCatalog(overrides?: { tenantId?: string; groupId?: string }) {
  const tenantId = overrides?.tenantId ?? "tenant-a";
  const groupId = overrides?.groupId ?? "group-ops";
  const entry = buildGroupWorkspaceCatalogEntry({
    tenantId,
    groupId,
    workspaceRoot: CANONICAL_LOCATOR,
  });
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: { [entry.resource.resourceId]: entry.resource },
    bindings: { [entry.binding.bindingId]: entry.binding },
  });
}

export function ambiguousCatalog() {
  const first = buildUserOwnedWorkspaceCatalogEntry({
    tenantId: "tenant-a",
    userId: "user-elle",
    agentAssetId: "asset-alpha",
    workspaceRoot: CANONICAL_LOCATOR,
  });
  const second = buildUserOwnedWorkspaceCatalogEntry({
    tenantId: "tenant-a",
    userId: "user-elle",
    agentAssetId: "asset-alpha",
    workspaceRoot: "/var/workspaces/tenant-a/asset-alpha-b",
  });
  const secondResource = {
    ...second.resource,
    resourceId: `${first.resource.resourceId}:twin`,
  };
  const secondBinding = {
    ...second.binding,
    resourceId: secondResource.resourceId,
    bindingId: `${secondResource.resourceId}:canonical`,
  };
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: {
      [first.resource.resourceId]: first.resource,
      [secondResource.resourceId]: secondResource,
    },
    bindings: {
      [first.binding.bindingId]: first.binding,
      [secondBinding.bindingId]: secondBinding,
    },
  });
}

/** Same agentAssetId, different owner scopes — first-match would incorrectly succeed. */
export function multiOwnerSameAssetCatalog() {
  const user = buildUserOwnedWorkspaceCatalogEntry({
    tenantId: "tenant-a",
    userId: "user-elle",
    agentAssetId: "asset-alpha",
    workspaceRoot: CANONICAL_LOCATOR,
  });
  const seat = positionOwnedCatalog({
    tenantId: "tenant-a",
    seatId: "seat-sales",
    agentAssetId: "asset-alpha",
  }).snapshot();
  const seatResource = Object.values(seat.resources)[0];
  const seatBinding = Object.values(seat.bindings)[0];
  if (!seatResource || !seatBinding) {
    throw new Error("position fixture missing");
  }
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: {
      [user.resource.resourceId]: user.resource,
      [seatResource.resourceId]: seatResource,
    },
    bindings: {
      [user.binding.bindingId]: user.binding,
      [seatBinding.bindingId]: seatBinding,
    },
  });
}

export function trustedPlatformAuthStore(userId = "user-elle"): PlatformAuthStore {
  return {
    users: {
      [userId]: {
        id: userId,
        email: `${userId}@example.com`,
        displayName: userId,
        status: "active",
        scopes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
    memberships: {},
    enterprises: {},
    employeeProvisions: {},
  } as unknown as PlatformAuthStore;
}

export function trustedSeatStore(params?: {
  seatId?: string;
  tenantId?: string;
  currentEmployeeId?: string;
}): EnterpriseSeatAssetsStore {
  const seatId = params?.seatId ?? "seat-sales";
  const tenantId = params?.tenantId ?? "tenant-a";
  const currentEmployeeId = params?.currentEmployeeId ?? "user-elle";
  return {
    version: 1,
    seats: {
      [seatId]: {
        seatId,
        tenantId,
        title: "Sales",
        status: "occupied",
        currentEmployeeId,
        defaultSpaceIds: [],
        defaultAgentAssetIds: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
    bindings: {},
    accessPolicies: {},
    assetBindings: {},
    credentialBindings: {},
    handovers: {},
    offers: {},
    auditEvents: {},
    enterpriseIdentities: {},
    identityUsagePolicies: {},
    dataSourceIdentityBindings: {},
    employeeIdentityEnrollments: {},
  };
}

export function getMocks(): CrMocks {
  return mocks;
}

export function resetCrMocks() {
  for (const mock of Object.values(mocks)) {
    mock.mockReset();
  }
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.appendFile.mockResolvedValue(undefined);
  mocks.access.mockResolvedValue(undefined);
  mocks.writeConfigFile.mockResolvedValue(undefined);
  mocks.writeFileWithinRoot.mockResolvedValue(undefined);
  mocks.readLocalFileSafely.mockResolvedValue({
    buffer: Buffer.from("ok"),
    stat: { size: 2, mtimeMs: 1 },
  });
  mocks.movePathToTrash.mockResolvedValue(undefined);
  mocks.decommissionRobotWorkspace.mockResolvedValue({
    workspaceId: "ws-1",
    localPath: null,
    runtimePath: null,
  });
  mocks.pruneAgentConfig.mockReturnValue({ config: { agents: { list: [] } }, removedBindings: 0 });
  mocks.applyAgentMemoryDisposal.mockResolvedValue(undefined);
  mocks.applyAgentConfig.mockImplementation((_cfg, patch) => ({
    data: { mode: "managed" },
    agents: { list: [{ id: patch.agentId }] },
  }));
  mocks.ensureAgentWorkspace.mockResolvedValue(undefined);
  mocks.authorizeAgentWorkspaceFileAccess.mockResolvedValue({
    ok: true,
    absoluteFilePath: `${CANONICAL_LOCATOR}/IDENTITY.md`,
    access: { baseReal: CANONICAL_LOCATOR },
  });
  mocks.resolveKnowledgeSourceContext.mockResolvedValue({ userId: "user-elle" });
  mocks.resolvePlatformAuthConfig.mockReturnValue(null);
  mocks.loadPlatformAuthStore.mockResolvedValue(null);
  mocks.loadSeatAssetsStoreForTenantId.mockResolvedValue(null);
  mocks.loadAuthoritativeGroupMembers.mockResolvedValue([]);
  mocks.ensureGovernedWorkspaceCatalogIdentity.mockResolvedValue({});
  mocks.findActiveOwnershipRecord.mockReturnValue(null);
}

function installTenantActor() {
  mocks.resolveTenantContext.mockResolvedValue({
    tenantId: "tenant-a",
    userId: "user-elle",
    domain: "enterprise",
  });
  mocks.resolveEmployeeWorkbenchActor.mockResolvedValue({
    userId: "user-elle",
    userEmail: "elle@example.com",
    tenantId: "tenant-a",
    seatAgentIds: ["research"],
    seatSpaceIds: [],
  });
}

export function installCompleteTrustedContext() {
  installTenantActor();
  mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
    catalog: completeCatalog().catalog,
    agentAssetId: "asset-alpha",
  });
}

export function installPositionMemberContext() {
  installTenantActor();
  mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
    catalog: positionOwnedCatalog(),
    agentAssetId: "asset-alpha",
  });
  mocks.resolvePlatformAuthConfig.mockReturnValue({ enabled: true });
  mocks.loadPlatformAuthStore.mockResolvedValue(trustedPlatformAuthStore());
  mocks.loadSeatAssetsStoreForTenantId.mockResolvedValue(trustedSeatStore());
}

export function installGroupMemberContext() {
  installTenantActor();
  mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
    catalog: groupOwnedCatalog(),
    agentAssetId: "group-ops",
  });
  mocks.loadAuthoritativeGroupMembers.mockResolvedValue([
    { userId: "user-elle", status: "active" },
  ]);
}

export function trustedClient() {
  return { sessionDomain: "enterprise" as const, user: "elle@example.com" };
}

export function handlerArgs(params: Record<string, unknown>, respond: ReturnType<typeof vi.fn>) {
  return {
    req: {} as never,
    params,
    respond: respond as never,
    client: trustedClient() as never,
    isWebchatConnect: () => false,
    context: {} as never,
  };
}

export function expectDenied(respond: ReturnType<typeof vi.fn>, reasonCode: string) {
  expect(respond).toHaveBeenCalled();
  expect(respond.mock.calls[0]?.[0]).toBe(false);
  expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toContain(
    `workspace locator denied: ${reasonCode}`,
  );
}

export function expectDeniedAny(respond: ReturnType<typeof vi.fn>, reasonCodes: string[]) {
  expect(respond).toHaveBeenCalled();
  expect(respond.mock.calls[0]?.[0]).toBe(false);
  const message = String(respond.mock.calls[0]?.[2]?.message ?? "");
  expect(reasonCodes.some((code) => message.includes(`workspace locator denied: ${code}`))).toBe(
    true,
  );
}

export function expectZeroFileOps() {
  expect(mocks.mkdir).not.toHaveBeenCalled();
  expect(mocks.appendFile).not.toHaveBeenCalled();
  expect(mocks.writeConfigFile).not.toHaveBeenCalled();
  expect(mocks.writeFileWithinRoot).not.toHaveBeenCalled();
  expect(mocks.readLocalFileSafely).not.toHaveBeenCalled();
  expect(mocks.movePathToTrash).not.toHaveBeenCalled();
  expect(mocks.applyAgentMemoryDisposal).not.toHaveBeenCalled();
  expect(mocks.decommissionRobotWorkspace).not.toHaveBeenCalled();
  expect(mocks.ensureAgentWorkspace).not.toHaveBeenCalled();
}

export function expectNoEmptyOrCwdTarget(calls: unknown[][]) {
  for (const args of calls) {
    const target = args[0];
    expect(target).not.toBe("");
    expect(target).not.toBe(CWD);
    if (typeof target === "string") {
      expect(target).not.toContain(CWD);
    }
  }
}
