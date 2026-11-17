import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEmployeeAccessSnapshot,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import type { PlatformAuthStore } from "../platform-auth/store-types.js";
import {
  createEmptyWorkspaceCatalog,
  InMemoryWorkspaceResourceCatalog,
} from "../workspace-resolver/catalog.js";
import type { WorkspaceResourceCatalog } from "../workspace-resolver/catalog.js";

const resolveTenantContextMock = vi.hoisted(() => vi.fn());
const resolveEmployeeWorkbenchActorMock = vi.hoisted(() => vi.fn());
const loadExistingGovernedWorkspaceIdentityMock = vi.hoisted(() => vi.fn());
const ensureGovernedWorkspaceCatalogIdentityMock = vi.hoisted(() => vi.fn());
const ensureOccupiedSeatWorkspaceCatalogMock = vi.hoisted(() => vi.fn());
const loadSeatAssetsStoreForTenantIdMock = vi.hoisted(() => vi.fn());
const saveSeatAssetsStoreForTenantIdMock = vi.hoisted(() => vi.fn());
const loadPlatformAuthStoreMock = vi.hoisted(() => vi.fn());

vi.mock("../tenant-context.js", () => ({
  resolveTenantContextForSessionStore: (...args: unknown[]) => resolveTenantContextMock(...args),
}));

vi.mock("../employee-workbench-scope.js", () => ({
  resolveEmployeeWorkbenchActor: (...args: unknown[]) => resolveEmployeeWorkbenchActorMock(...args),
}));

vi.mock("../data-governance/workspace-catalog-projection.js", () => ({
  loadExistingGovernedWorkspaceIdentity: (...args: unknown[]) =>
    loadExistingGovernedWorkspaceIdentityMock(...args),
  ensureGovernedWorkspaceCatalogIdentity: (...args: unknown[]) =>
    ensureGovernedWorkspaceCatalogIdentityMock(...args),
  ensureOccupiedSeatWorkspaceCatalog: (...args: unknown[]) =>
    ensureOccupiedSeatWorkspaceCatalogMock(...args),
}));

vi.mock("../platform-auth/seat-store-loader.js", () => ({
  loadSeatAssetsStoreForTenantId: (...args: unknown[]) =>
    loadSeatAssetsStoreForTenantIdMock(...args),
  saveSeatAssetsStoreForTenantId: (...args: unknown[]) =>
    saveSeatAssetsStoreForTenantIdMock(...args),
}));

vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => ({ enabled: true }),
  loadPlatformAuthStore: (...args: unknown[]) => loadPlatformAuthStoreMock(...args),
}));

const { resolveAgentsHandlerWorkspaceLocator } =
  await import("./agents-handler-workspace-locator.js");
const { resolvePathBSeatAgentWorkspaceLocator } =
  await import("../workspace/seat-visible-agent-projection.js");

const AGENT_ID = "agt-daniel-hhd-gmail-com-nchn5ey";
const ASSET_ID = "asset-senior-secretary";
const REGISTRY_ASSET_ID = "a84dd78f-972b-4f28-94de-d2fbca3d9cb1";
const SEAT_ID = "seat-ceo-daniel-main";
const USER_ID = "90fed19a-1c8b-4420-87e0-bcc6165e32fa";
const TENANT_ID = "tenant-a";
const FOREIGN_LOCATOR = "/var/foreign/seat-old/workspace";

function platformAuthStore(): PlatformAuthStore {
  return {
    users: {
      [USER_ID]: {
        id: USER_ID,
        email: "daniel.hhd@gmail.com",
        displayName: "Daniel",
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

function seatStore(currentEmployeeId = USER_ID): EnterpriseSeatAssetsStore {
  return {
    version: 1,
    seats: {
      [SEAT_ID]: {
        seatId: SEAT_ID,
        tenantId: TENANT_ID,
        title: "CEO",
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

function positionCatalog(
  seatId: string,
  locator: string,
  agentAssetId = ASSET_ID,
): WorkspaceResourceCatalog {
  const resourceId = `ws:${TENANT_ID}:seat:${seatId}:asset:${agentAssetId}`;
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: {
      [resourceId]: {
        resourceId,
        resourceType: "workspace",
        tenantId: TENANT_ID,
        ownerScope: { kind: "position_owned", seatId, agentAssetId },
        lifecycleState: "active",
        classification: "agent.workspace",
        governanceVersion: 1,
      },
    },
    bindings: {
      [`${resourceId}:canonical`]: {
        bindingId: `${resourceId}:canonical`,
        resourceId,
        role: "canonical",
        locator,
        state: "active",
        contentVersion: "v1",
      },
    },
  });
}

function mergedCatalog(occupiedLocator: string, agentAssetId = ASSET_ID): WorkspaceResourceCatalog {
  const foreign = positionCatalog("seat-old-handover", FOREIGN_LOCATOR, agentAssetId);
  const occupied = positionCatalog(SEAT_ID, occupiedLocator, agentAssetId);
  const foreignSnap = foreign.snapshot();
  const occupiedSnap = occupied.snapshot();
  return new InMemoryWorkspaceResourceCatalog({
    ...createEmptyWorkspaceCatalog().snapshot(),
    resources: { ...foreignSnap.resources, ...occupiedSnap.resources },
    bindings: { ...foreignSnap.bindings, ...occupiedSnap.bindings },
  });
}

const managedCfg = {
  data: { mode: "managed" as const },
  agents: {
    list: [
      {
        id: AGENT_ID,
        name: "高级秘书",
        ownerId: SEAT_ID,
        workspace: `/legacy/workspace-${AGENT_ID}`,
      },
    ],
  },
};

describe("Path B seat-visible agent grant heal", () => {
  beforeEach(() => {
    resolveTenantContextMock.mockReset();
    resolveEmployeeWorkbenchActorMock.mockReset();
    loadExistingGovernedWorkspaceIdentityMock.mockReset();
    ensureGovernedWorkspaceCatalogIdentityMock.mockReset();
    ensureOccupiedSeatWorkspaceCatalogMock.mockReset();
    loadSeatAssetsStoreForTenantIdMock.mockReset();
    saveSeatAssetsStoreForTenantIdMock.mockReset();
    loadPlatformAuthStoreMock.mockReset();
    resolveTenantContextMock.mockResolvedValue({
      tenantId: TENANT_ID,
      userId: USER_ID,
      domain: "enterprise",
    });
    resolveEmployeeWorkbenchActorMock.mockResolvedValue({
      userId: USER_ID,
      userEmail: "daniel.hhd@gmail.com",
      currentSeatId: SEAT_ID,
      seatAgentIds: [AGENT_ID],
    });
    loadPlatformAuthStoreMock.mockResolvedValue(platformAuthStore());
    saveSeatAssetsStoreForTenantIdMock.mockResolvedValue(undefined);
    ensureOccupiedSeatWorkspaceCatalogMock.mockResolvedValue(undefined);
    ensureGovernedWorkspaceCatalogIdentityMock.mockResolvedValue({});
  });

  it("honors a formal seat grant when config and catalog still name a foreign seat", async () => {
    const store = seatStore();
    store.seats[SEAT_ID].defaultAgentAssetIds = [AGENT_ID];
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    let projectedLocator = "";
    ensureOccupiedSeatWorkspaceCatalogMock.mockImplementation(
      async (params: { locator: string; agentAssetId: string }) => {
        expect(params.agentAssetId).toBe(ASSET_ID);
        projectedLocator = params.locator;
      },
    );
    loadExistingGovernedWorkspaceIdentityMock.mockImplementation(async () => {
      if (!projectedLocator) {
        return {
          catalog: positionCatalog("seat-old-handover", FOREIGN_LOCATOR),
          agentAssetId: ASSET_ID,
        };
      }
      return {
        catalog: mergedCatalog(projectedLocator),
        agentAssetId: ASSET_ID,
      };
    });

    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: {
        ...managedCfg,
        agents: {
          ...managedCfg.agents,
          list: managedCfg.agents.list.map((agent) => ({ ...agent, ownerId: "seat-old-handover" })),
        },
      },
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.handle.locator).toBe(projectedLocator);
      expect(result.handle.locator).not.toBe(FOREIGN_LOCATOR);
    }
    expect(projectedLocator).toContain(
      path.join("tenants", TENANT_ID, "users", USER_ID, "OpenBot", "agents", AGENT_ID, "workspace"),
    );
    expect(projectedLocator).not.toContain(`workspace-${AGENT_ID}`);
    expect(projectedLocator).not.toContain("/legacy/");
    expect(ensureGovernedWorkspaceCatalogIdentityMock).not.toHaveBeenCalled();
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).toEqual([AGENT_ID]);
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).not.toContain(ASSET_ID);
  });

  it("projects the occupied seat when catalog is a foreign seat and grants are empty", async () => {
    const store = seatStore();
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    let projectedLocator = "";
    ensureOccupiedSeatWorkspaceCatalogMock.mockImplementation(
      async (params: { locator: string; agentAssetId: string }) => {
        expect(params.agentAssetId).toBe(ASSET_ID);
        projectedLocator = params.locator;
      },
    );
    loadExistingGovernedWorkspaceIdentityMock.mockImplementation(async () => {
      if (!projectedLocator) {
        return {
          catalog: positionCatalog("seat-old-handover", FOREIGN_LOCATOR),
          agentAssetId: ASSET_ID,
        };
      }
      return {
        catalog: mergedCatalog(projectedLocator),
        agentAssetId: ASSET_ID,
      };
    });

    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: managedCfg,
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.handle.locator).toBe(projectedLocator);
      expect(result.handle.locator).not.toBe(FOREIGN_LOCATOR);
    }
    expect(projectedLocator).toContain(
      path.join("tenants", TENANT_ID, "users", USER_ID, "OpenBot", "agents", AGENT_ID, "workspace"),
    );
    expect(projectedLocator).not.toContain(`workspace-${AGENT_ID}`);
    expect(projectedLocator).not.toContain("/legacy/");
    expect(ensureGovernedWorkspaceCatalogIdentityMock).not.toHaveBeenCalled();
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).toEqual([AGENT_ID]);
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).not.toContain(ASSET_ID);
    expect(
      Object.values(store.assetBindings).filter(
        (binding) => binding.assetId === AGENT_ID && binding.status === "active",
      ),
    ).toHaveLength(1);
    expect(Object.values(store.assetBindings).some((binding) => binding.assetId === ASSET_ID)).toBe(
      false,
    );
    expect(
      Object.values(store.accessPolicies).some((policy) => policy.resourceId === ASSET_ID),
    ).toBe(false);
    expect(
      Object.values(store.accessPolicies).some(
        (policy) =>
          policy.resourceId === AGENT_ID &&
          policy.action === "execute" &&
          policy.subjectId === USER_ID &&
          !policy.revokedAt,
      ),
    ).toBe(true);
    expect(saveSeatAssetsStoreForTenantIdMock).toHaveBeenCalledWith(TENANT_ID, store, managedCfg);
  });

  it("does not heal or retarget a robot the occupied seat does not list", async () => {
    const store = seatStore();
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({
      catalog: positionCatalog("seat-old-handover", FOREIGN_LOCATOR),
      agentAssetId: ASSET_ID,
    });
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: {
        data: { mode: "managed" },
        agents: {
          list: [{ id: AGENT_ID, name: "高级秘书", ownerId: USER_ID }],
        },
      },
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });
    expect(ensureOccupiedSeatWorkspaceCatalogMock).not.toHaveBeenCalled();
    expect(saveSeatAssetsStoreForTenantIdMock).not.toHaveBeenCalled();
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).toEqual([]);
    expect(store.assetBindings).toEqual({});
  });

  it("keeps auth_failure when the actor does not occupy the seat", async () => {
    const store = seatStore("someone-else");
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({
      catalog: positionCatalog("seat-old-handover", FOREIGN_LOCATOR),
      agentAssetId: ASSET_ID,
    });
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: managedCfg,
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({ ok: false, reasonCode: "auth_failure", failClosed: true });
    expect(saveSeatAssetsStoreForTenantIdMock).not.toHaveBeenCalled();
    expect(ensureOccupiedSeatWorkspaceCatalogMock).not.toHaveBeenCalled();
  });

  it("heals grants for an occupied-seat catalog row that omitted defaultAgentAssetIds", async () => {
    const store = seatStore();
    const locator = resolvePathBSeatAgentWorkspaceLocator({
      tenantId: TENANT_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
    });
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({
      catalog: positionCatalog(SEAT_ID, locator),
      agentAssetId: ASSET_ID,
    });
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: managedCfg,
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.handle.locator).toBe(locator);
    }
    expect(ensureOccupiedSeatWorkspaceCatalogMock).not.toHaveBeenCalled();
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).toEqual([AGENT_ID]);
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).not.toContain(ASSET_ID);
    expect(saveSeatAssetsStoreForTenantIdMock).toHaveBeenCalled();
  });

  it("does not bind a distinct registry agentAssetId when seat defaults are already full", async () => {
    const store = seatStore();
    store.seats[SEAT_ID].defaultAgentAssetIds = [
      "main",
      "panda",
      "bot-2",
      "bot--agent",
      "bot-skill",
    ];
    store.bindings["bind-employee"] = {
      bindingId: "bind-employee",
      seatId: SEAT_ID,
      tenantId: TENANT_ID,
      employeeId: USER_ID,
      bindingStatus: "active",
      effectiveAt: "2026-01-01T00:00:00.000Z",
    };
    store.assetBindings["bind-runtime"] = {
      assetBindingId: "bind-runtime",
      tenantId: TENANT_ID,
      seatId: SEAT_ID,
      assetType: "agent",
      assetId: AGENT_ID,
      status: "active",
      source: "manual",
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    };
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    let projectedAssetId = "";
    let projectedLocator = "";
    ensureOccupiedSeatWorkspaceCatalogMock.mockImplementation(
      async (params: { locator: string; agentAssetId: string }) => {
        projectedAssetId = params.agentAssetId;
        projectedLocator = params.locator;
      },
    );
    loadExistingGovernedWorkspaceIdentityMock.mockImplementation(async () => {
      if (!projectedLocator) {
        return {
          catalog: positionCatalog("seat-old-handover", FOREIGN_LOCATOR, REGISTRY_ASSET_ID),
          agentAssetId: REGISTRY_ASSET_ID,
        };
      }
      return {
        catalog: mergedCatalog(projectedLocator, REGISTRY_ASSET_ID),
        agentAssetId: REGISTRY_ASSET_ID,
      };
    });

    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: managedCfg,
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.handle.locator).toBe(projectedLocator);
      expect(result.handle.locator).toContain(
        path.join(
          "tenants",
          TENANT_ID,
          "users",
          USER_ID,
          "OpenBot",
          "agents",
          AGENT_ID,
          "workspace",
        ),
      );
      expect(result.handle.locator).not.toContain(REGISTRY_ASSET_ID);
    }
    expect(projectedAssetId).toBe(REGISTRY_ASSET_ID);
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).toEqual([
      "main",
      "panda",
      "bot-2",
      "bot--agent",
      "bot-skill",
    ]);
    expect(
      Object.values(store.assetBindings).some((binding) => binding.assetId === REGISTRY_ASSET_ID),
    ).toBe(false);
    expect(
      Object.values(store.accessPolicies).some((policy) => policy.resourceId === REGISTRY_ASSET_ID),
    ).toBe(false);
    expect(saveSeatAssetsStoreForTenantIdMock).not.toHaveBeenCalled();
    const employeeAccess = buildEmployeeAccessSnapshot({
      store,
      tenantId: TENANT_ID,
      employeeId: USER_ID,
    });
    expect(employeeAccess.agentIds).toContain(AGENT_ID);
    expect(employeeAccess.agentIds).not.toContain(REGISTRY_ASSET_ID);
  });

  it("mints a missing catalog on the Path B root instead of the legacy config workspace", async () => {
    const store = seatStore();
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({});
    ensureGovernedWorkspaceCatalogIdentityMock.mockImplementation(
      async (params: { workspaceLocator: string }) => ({
        catalog: positionCatalog(SEAT_ID, params.workspaceLocator),
        agentAssetId: ASSET_ID,
      }),
    );
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: managedCfg,
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({ ok: true });
    const workspaceLocator = ensureGovernedWorkspaceCatalogIdentityMock.mock.calls[0]?.[0]
      ?.workspaceLocator as string;
    expect(workspaceLocator).toContain(
      path.join("tenants", TENANT_ID, "users", USER_ID, "OpenBot", "agents", AGENT_ID, "workspace"),
    );
    expect(workspaceLocator).not.toContain("/legacy/");
    if (result.ok) {
      expect(result.handle.locator).toBe(workspaceLocator);
    }
  });

  it("retargets an occupied-seat row whose locator is the agent directory onto Path B", async () => {
    const store = seatStore();
    store.seats[SEAT_ID].defaultAgentAssetIds = [
      "main",
      "panda",
      "bot-2",
      "bot--agent",
      "bot-skill",
    ];
    store.assetBindings["bind-senior"] = {
      bindingId: "bind-senior",
      tenantId: TENANT_ID,
      seatId: SEAT_ID,
      assetType: "agent",
      assetId: AGENT_ID,
      status: "active",
      source: "manual",
      createdBy: USER_ID,
      createdAt: "2026-09-16T00:00:00.000Z",
    } as never;
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    const agentDir = `/root/.openbot/agents/${AGENT_ID}/agent`;
    let projectedLocator = "";
    ensureOccupiedSeatWorkspaceCatalogMock.mockImplementation(
      async (params: { locator: string; agentAssetId: string }) => {
        expect(params.agentAssetId).toBe(AGENT_ID);
        projectedLocator = params.locator;
      },
    );
    loadExistingGovernedWorkspaceIdentityMock.mockImplementation(async () => {
      const locator = projectedLocator || agentDir;
      const resourceId = `ws:${TENANT_ID}:seat:${SEAT_ID}:asset:${AGENT_ID}`;
      return {
        catalog: new InMemoryWorkspaceResourceCatalog({
          ...createEmptyWorkspaceCatalog().snapshot(),
          resources: {
            [resourceId]: {
              resourceId,
              resourceType: "workspace",
              tenantId: TENANT_ID,
              ownerScope: {
                kind: "position_owned",
                seatId: SEAT_ID,
                agentAssetId: AGENT_ID,
              },
              lifecycleState: "active",
              classification: "agent.workspace",
              governanceVersion: 1,
            },
          },
          bindings: {
            [`${resourceId}:canonical`]: {
              bindingId: `${resourceId}:canonical`,
              resourceId,
              role: "canonical",
              locator,
              state: "active",
              contentVersion: "v1",
            },
          },
        }),
        agentAssetId: AGENT_ID,
      };
    });
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: managedCfg,
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.handle.locator).toBe(projectedLocator);
      expect(result.handle.locator).not.toBe(agentDir);
      expect(result.handle.locator).not.toContain("/legacy/");
      expect(result.handle.locator).toContain(
        path.join(
          "tenants",
          TENANT_ID,
          "users",
          USER_ID,
          "OpenBot",
          "agents",
          AGENT_ID,
          "workspace",
        ),
      );
    }
    expect(ensureGovernedWorkspaceCatalogIdentityMock).not.toHaveBeenCalled();
  });

  it("retargets a gateway state-dir shadow onto the tenant volume", async () => {
    const tenantsRoot = path.join("/root", "openbot-tenants");
    const previous = process.env.OPENBOT_TENANTS_ROOT;
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    try {
      const store = seatStore();
      loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
      const stateDirShadow = path.join(
        "/root",
        ".openbot",
        "tenants",
        TENANT_ID,
        "users",
        USER_ID,
        "OpenBot",
        "agents",
        AGENT_ID,
        "workspace",
      );
      let projectedLocator = "";
      ensureOccupiedSeatWorkspaceCatalogMock.mockImplementation(
        async (params: { locator: string }) => {
          projectedLocator = params.locator;
        },
      );
      loadExistingGovernedWorkspaceIdentityMock.mockImplementation(async () => {
        const locator = projectedLocator || stateDirShadow;
        const resourceId = `ws:${TENANT_ID}:seat:${SEAT_ID}:asset:${AGENT_ID}`;
        return {
          catalog: new InMemoryWorkspaceResourceCatalog({
            ...createEmptyWorkspaceCatalog().snapshot(),
            resources: {
              [resourceId]: {
                resourceId,
                resourceType: "workspace",
                tenantId: TENANT_ID,
                ownerScope: {
                  kind: "position_owned",
                  seatId: SEAT_ID,
                  agentAssetId: AGENT_ID,
                },
                lifecycleState: "active",
                classification: "agent.workspace",
                governanceVersion: 1,
              },
            },
            bindings: {
              [`${resourceId}:canonical`]: {
                bindingId: `${resourceId}:canonical`,
                resourceId,
                role: "canonical",
                locator,
                state: "active",
                contentVersion: "v1",
              },
            },
          }),
          agentAssetId: AGENT_ID,
        };
      });
      const result = await resolveAgentsHandlerWorkspaceLocator({
        client: { user: "daniel.hhd@gmail.com" } as never,
        cfg: managedCfg,
        agentId: AGENT_ID,
        purpose: "trusted.agent.locator",
      });
      const canonical = path.join(
        tenantsRoot,
        TENANT_ID,
        "users",
        USER_ID,
        "OpenBot",
        "agents",
        AGENT_ID,
        "workspace",
      );
      expect(result).toMatchObject({ ok: true });
      if (result.ok) {
        expect(result.handle.locator).toBe(canonical);
        expect(result.handle.locator).not.toBe(stateDirShadow);
      }
    } finally {
      if (previous === undefined) {
        delete process.env.OPENBOT_TENANTS_ROOT;
      } else {
        process.env.OPENBOT_TENANTS_ROOT = previous;
      }
    }
  });

  it("mints Path B from the runtime agent id when no workspace row is visible", async () => {
    const store = seatStore();
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    let projectedLocator = "";
    ensureOccupiedSeatWorkspaceCatalogMock.mockImplementation(
      async (params: { locator: string; agentAssetId: string }) => {
        expect(params.agentAssetId).toBe(AGENT_ID);
        projectedLocator = params.locator;
      },
    );
    ensureGovernedWorkspaceCatalogIdentityMock.mockResolvedValue({});
    loadExistingGovernedWorkspaceIdentityMock.mockImplementation(async () => {
      if (!projectedLocator) {
        return {};
      }
      const resourceId = `ws:${TENANT_ID}:seat:${SEAT_ID}:asset:${AGENT_ID}`;
      return {
        catalog: new InMemoryWorkspaceResourceCatalog({
          ...createEmptyWorkspaceCatalog().snapshot(),
          resources: {
            [resourceId]: {
              resourceId,
              resourceType: "workspace",
              tenantId: TENANT_ID,
              ownerScope: {
                kind: "position_owned",
                seatId: SEAT_ID,
                agentAssetId: AGENT_ID,
              },
              lifecycleState: "active",
              classification: "agent.workspace",
              governanceVersion: 1,
            },
          },
          bindings: {
            [`${resourceId}:canonical`]: {
              bindingId: `${resourceId}:canonical`,
              resourceId,
              role: "canonical",
              locator: projectedLocator,
              state: "active",
              contentVersion: "v1",
            },
          },
        }),
        agentAssetId: AGENT_ID,
      };
    });
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: managedCfg,
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.handle.locator).toBe(projectedLocator);
      expect(result.handle.locator).not.toContain("agents/" + AGENT_ID + "/agent");
    }
    expect(store.seats[SEAT_ID]?.defaultAgentAssetIds).toContain(AGENT_ID);
  });

  it("returns seat_agent_unbound when the occupied-seat row cannot be projected", async () => {
    const store = seatStore();
    loadSeatAssetsStoreForTenantIdMock.mockResolvedValue(store);
    loadExistingGovernedWorkspaceIdentityMock.mockResolvedValue({
      catalog: positionCatalog("seat-old-handover", FOREIGN_LOCATOR),
      agentAssetId: ASSET_ID,
    });
    ensureOccupiedSeatWorkspaceCatalogMock.mockRejectedValue(new Error("catalog down"));
    const result = await resolveAgentsHandlerWorkspaceLocator({
      client: { user: "daniel.hhd@gmail.com" } as never,
      cfg: managedCfg,
      agentId: AGENT_ID,
      purpose: "trusted.agent.locator",
    });
    expect(result).toMatchObject({
      ok: false,
      reasonCode: "seat_agent_unbound",
      failClosed: true,
    });
  });
});
