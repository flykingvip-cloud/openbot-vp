import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveTrustedEnterpriseDataExecutionContextMock = vi.hoisted(() => vi.fn());
const loadEnterpriseSeatAssetsStoreMock = vi.hoisted(() => vi.fn());

vi.mock("./enterprise-data/enterprise-data-seat-context.js", () => ({
  resolveTrustedEnterpriseDataExecutionContext: (...args: unknown[]) =>
    resolveTrustedEnterpriseDataExecutionContextMock(...args),
}));

vi.mock("./enterprise-seat-assets-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enterprise-seat-assets-store.js")>();
  return {
    ...actual,
    loadEnterpriseSeatAssetsStore: (...args: unknown[]) =>
      loadEnterpriseSeatAssetsStoreMock(...args),
  };
});

vi.mock("./tenant-context.js", () => ({
  resolveControlPlaneStorePathForClient: vi.fn(async () => undefined),
  resolveControlPlaneStorePathForTenantId: vi.fn(() => undefined),
}));

const { resolveOperationalIdentityRuntimeScope, listOperationalIdentityRuntimeAccess } =
  await import("./enterprise-operational-identity-runtime.js");

const NOW = "2026-09-19T06:16:56.046Z";

function enrollmentStore() {
  return {
    seats: {
      "seat-1": {
        seatId: "seat-1",
        tenantId: "001",
        title: "管理层",
        status: "occupied",
        currentEmployeeId: "emp-1",
        defaultSpaceIds: [],
        defaultAgentAssetIds: ["bot--agent"],
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    bindings: {
      "bind-1": {
        bindingId: "bind-1",
        tenantId: "001",
        seatId: "seat-1",
        employeeId: "emp-1",
        bindingStatus: "active",
        effectiveAt: NOW,
      },
    },
    enterpriseIdentities: {
      "id-tm": {
        identityId: "id-tm",
        tenantId: "001",
        provider: "tencent-meeting",
        displayName: "腾讯会议（企业）",
        credentialBindingId: "cb-1",
        status: "active",
        capabilities: ["schedule_meeting", "list_meetings"],
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    identityUsagePolicies: {
      "pol-1": {
        policyId: "pol-1",
        tenantId: "001",
        identityId: "id-tm",
        seatIds: ["seat-1"],
        allowedAgentIds: [],
        allowedActions: ["schedule_meeting", "list_meetings"],
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    employeeIdentityEnrollments: {
      "enroll-1": {
        enrollmentId: "enroll-1",
        tenantId: "001",
        employeeId: "emp-1",
        agentId: "bot--agent",
        identityId: "id-tm",
        allowedActions: ["schedule_meeting", "list_meetings"],
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    credentialBindings: {
      "cb-1": {
        credentialBindingId: "cb-1",
        tenantId: "001",
        connectorId: "tencent-meeting",
        ownerType: "seat",
        ownerId: "seat-1",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
    },
    connectorProfiles: {},
    seatAssets: {},
    assetBindings: {},
    auditEvents: {},
    offers: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(new Error("no session"));
  loadEnterpriseSeatAssetsStoreMock.mockResolvedValue(enrollmentStore());
});

describe("resolveOperationalIdentityRuntimeScope", () => {
  it("resolves from a unique employee enrollment when the agent session has no email", async () => {
    const scope = await resolveOperationalIdentityRuntimeScope(null, { agentId: "bot--agent" });
    expect(scope).toEqual({
      tenantId: "001",
      seatId: "seat-1",
      agentId: "bot--agent",
      employeeId: "emp-1",
    });
  });

  it("does not use enrollment fallback for grant/revoke", async () => {
    const scope = await resolveOperationalIdentityRuntimeScope(null, {
      agentId: "bot--agent",
      allowEnrollmentFallback: false,
    });
    expect(scope).toBeNull();
  });

  it("lists only identities the employee enrolled for this agent", async () => {
    const access = await listOperationalIdentityRuntimeAccess({
      client: null,
      agentId: "bot--agent",
    });
    expect(access?.scope.agentId).toBe("bot--agent");
    expect(access?.entries).toEqual([
      expect.objectContaining({
        identityId: "id-tm",
        provider: "tencent-meeting",
        allowedActions: ["list_meetings", "schedule_meeting"],
      }),
    ]);
  });
});
