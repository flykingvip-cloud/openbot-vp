import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildUserOwnedWorkspaceCatalogEntry } from "../workspace-resolver/builders.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";

const resolveTenantContextMock = vi.hoisted(() => vi.fn());
const resolveEmployeeWorkbenchActorMock = vi.hoisted(() => vi.fn());
const loadExistingGovernedWorkspaceIdentityMock = vi.hoisted(() => vi.fn());
const ensureGovernedWorkspaceCatalogIdentityMock = vi.hoisted(() => vi.fn());
const loadSeatAssetsStoreForTenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("../tenant-context.js", () => ({
  resolveTenantContextForSessionStore: (...args: unknown[]) => resolveTenantContextMock(...args),
  resolveAgentWorkspaceDirForClient: async () => "/tmp/openbot-item7-cr-locator/asset-alpha",
}));

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: (...args: unknown[]) => resolveEmployeeWorkbenchActorMock(...args),
}));

vi.mock("../data-governance/workspace-catalog-projection.js", () => ({
  loadExistingGovernedWorkspaceIdentity: (...args: unknown[]) =>
    loadExistingGovernedWorkspaceIdentityMock(...args),
  ensureGovernedWorkspaceCatalogIdentity: (...args: unknown[]) =>
    ensureGovernedWorkspaceCatalogIdentityMock(...args),
}));

vi.mock("../platform-auth/seat-store-loader.js", () => ({
  loadSeatAssetsStoreForTenantId: (...args: unknown[]) =>
    loadSeatAssetsStoreForTenantIdMock(...args),
}));

const { resolveAgentsHandlerWorkspaceLocator } =
  await import("./agents-handler-workspace-locator.js");

const managedCfg = { data: { mode: "managed" as const } };

function userCatalog(workspaceRoot = "/var/workspaces/tenant-a/asset-alpha") {
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId: "tenant-a",
    userId: "user-elle",
    agentAssetId: "asset-alpha",
    workspaceRoot,
  });
  const catalog = new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: { [entry.resource.resourceId]: entry.resource },
    bindings: { [entry.binding.bindingId]: entry.binding },
  });
  return { entry, catalog };
}

describe("S29 agents-handler-workspace-locator precise reasonCodes", () => {
  beforeEach(() => {
    resolveTenantContextMock.mockReset();
    resolveEmployeeWorkbenchActorMock.mockReset();
    loadExistingGovernedWorkspaceIdentityMock.mockReset();
    ensureGovernedWorkspaceCatalogIdentityMock.mockReset();
    loadSeatAssetsStoreForTenantIdMock.mockReset();
    ensureGovernedWorkspaceCatalogIdentityMock.mockResolvedValue({});
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue({ seats: {}, bindings: {}, offers: {} });
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "tenant-a",
      userId: "user-elle",
      domain: "enterprise",
    });
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({ userId: "user-elle" });
  });

  it("emits catalog_projection_miss (not missing_grant) when projection returns empty identity", async () => {
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({});
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "elle@acme.com" } as never,
      cfg: managedCfg,
      agentId: "main",
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "catalog_projection_miss",
      failClosed: true,
    });
    expect(!result.ok && result.reasonCode).not.toBe("missing_grant");
  });

  it("emits missing_agent_asset when catalog exists but agentAssetId is absent", async () => {
    const { catalog } = userCatalog();
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({ catalog });
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "elle@acme.com" } as never,
      cfg: managedCfg,
      agentId: "main",
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "missing_agent_asset",
      failClosed: true,
    });
    expect(!result.ok && result.reasonCode).not.toBe("missing_grant");
  });

  it("passes seat grant into Item 7 when actor has currentSeatId and projection is empty", async () => {
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: "user-elle",
      currentSeatId: "seat-42",
    });
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({});
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "elle@acme.com" } as never,
      cfg: managedCfg,
      agentId: "main",
      purpose: "trusted.agent.locator",
    });
    // Grant is present → precise projection miss, not missing_grant.
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "catalog_projection_miss",
      failClosed: true,
    });
  });

  it("still resolves when complete catalog + asset identity is available", async () => {
    const { catalog, entry } = userCatalog();
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({
      catalog,
      agentAssetId: "asset-alpha",
    });
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "elle@acme.com" } as never,
      cfg: managedCfg,
      agentId: "research",
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.handle.locator).toBe("/var/workspaces/tenant-a/asset-alpha");
      expect(result.handle.resourceId).toBe(entry.resource.resourceId);
    }
    expect(ensureGovernedWorkspaceCatalogIdentityMock).not.toHaveBeenCalled();
  });

  it("resolves the user occupancy row when the same asset also has a seat catalog row", async () => {
    const user = buildUserOwnedWorkspaceCatalogEntry({
      tenantId: "tenant-a",
      userId: "user-elle",
      agentAssetId: "asset-alpha",
      workspaceRoot: "/var/workspaces/tenant-a/asset-alpha",
    });
    const seatResourceId = "ws:tenant-a:seat:seat-1:asset:asset-alpha";
    const catalog = new InMemoryWorkspaceResourceCatalog({
      ...createEmptyWorkspaceCatalog().snapshot(),
      resources: {
        [user.resource.resourceId]: user.resource,
        [seatResourceId]: {
          resourceId: seatResourceId,
          resourceType: "workspace",
          tenantId: "tenant-a",
          ownerScope: {
            kind: "position_owned",
            seatId: "seat-1",
            agentAssetId: "asset-alpha",
          },
          lifecycleState: "active",
          classification: "agent.workspace",
          governanceVersion: 1,
        },
      },
      bindings: {
        [user.binding.bindingId]: user.binding,
        [`${seatResourceId}:canonical`]: {
          bindingId: `${seatResourceId}:canonical`,
          resourceId: seatResourceId,
          role: "canonical",
          locator: "unplaced://classified/ws:tenant-a:seat:seat-1:asset:asset-alpha",
          state: "active",
          contentVersion: "v1",
        },
      },
    });
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({
      catalog,
      agentAssetId: "asset-alpha",
    });
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "elle@acme.com" } as never,
      cfg: managedCfg,
      agentId: "bot-skill",
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.handle.locator).toBe("/var/workspaces/tenant-a/asset-alpha");
      expect(result.handle.resourceId).toBe(user.resource.resourceId);
    }
  });

  it("rematerializes Catalog on projection miss then resolves", async () => {
    const { catalog, entry } = userCatalog();
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({});
    ensureGovernedWorkspaceCatalogIdentityMock.mockResolvedValue({
      catalog,
      agentAssetId: "asset-alpha",
    });
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "elle@acme.com" } as never,
      cfg: managedCfg,
      agentId: "bot-skill",
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.handle.locator).toBe("/var/workspaces/tenant-a/asset-alpha");
      expect(result.handle.resourceId).toBe(entry.resource.resourceId);
    }
    expect(ensureGovernedWorkspaceCatalogIdentityMock).toHaveBeenCalledTimes(1);
  });
});
