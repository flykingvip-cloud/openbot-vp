// @vitest-environment node
/**
 * P0 PEP coverage: collaboration-owner enforce + execute-path authz-denial audit.
 * Complements pure PDP unit tests in *.pdp.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerEnterpriseIdentity,
  upsertEmployeeEnterpriseIdentityEnrollment,
  upsertIdentityUsagePolicy,
} from "./enterprise-operational-identity-store.js";
import { normalizeEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-backend.js";
import {
  registerConnectorCredentialBinding,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

const loadEnterpriseSeatAssetsStoreMock = vi.hoisted(() => vi.fn());
const saveWithGovernanceMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
const resolveTrustedEnterpriseDataExecutionContextMock = vi.hoisted(() => vi.fn());
const executeActionMock = vi.hoisted(() => vi.fn());

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

vi.mock("./enterprise-operational-identity-governance.js", () => ({
  saveEnterpriseSeatAssetsStoreWithOiGovernance: (...args: unknown[]) =>
    saveWithGovernanceMock(...args),
}));

vi.mock("./enterprise-operational-identity-execution.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./enterprise-operational-identity-execution.js")>();
  return {
    ...actual,
    executeEnterpriseOperationalIdentityAction: (...args: unknown[]) => executeActionMock(...args),
  };
});

vi.mock("./tenant-context.js", () => ({
  TenantContextError: class TenantContextError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  resolveControlPlaneStorePathForClient: vi.fn(async () => undefined),
  resolveControlPlaneStorePathForTenantId: vi.fn(() => undefined),
}));

const {
  enforceOperationalIdentityRuntimeAccess,
  executeEnterpriseOperationalIdentityRuntimeAction,
} = await import("./enterprise-operational-identity-runtime.js");

const NOW = "2026-09-25T00:00:00.000Z";

function createStore(): EnterpriseSeatAssetsStore {
  return normalizeEnterpriseSeatAssetsStore(null, 4);
}

function seedWechatHighRiskIdentity(store: EnterpriseSeatAssetsStore): string {
  store.seats["seat-1"] = {
    seatId: "seat-1",
    tenantId: "acme",
    title: "Ops",
    status: "occupied",
    defaultSpaceIds: [],
    defaultAgentAssetIds: ["agent-1"],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const credential = registerConnectorCredentialBinding({
    store,
    tenantId: "acme",
    connectorId: "wechat-official",
    ownerType: "seat",
    ownerId: "seat-1",
    nowIso: NOW,
  });
  const identity = registerEnterpriseIdentity({
    store,
    tenantId: "acme",
    displayName: "OA Bot",
    credentialBindingId: credential.credentialBindingId,
    nowIso: NOW,
  });
  if (!identity.ok) {
    throw new Error("failed to register identity");
  }
  upsertIdentityUsagePolicy({
    store,
    tenantId: "acme",
    identityId: identity.identity.identityId,
    seatIds: ["seat-1"],
    allowedAgentIds: [],
    allowedActions: ["publish_draft", "publish_article", "broadcast_article"],
    nowIso: NOW,
  });
  return identity.identity.identityId;
}

/** P2: collaboration-owner high-risk paths require live seat binding to pass revalidation. */
function bindOwnerToSeat(
  store: EnterpriseSeatAssetsStore,
  params: { seatId?: string; employeeId: string } = { employeeId: "owner-emp" },
): void {
  const seatId = params.seatId ?? "seat-1";
  const seat = store.seats[seatId];
  if (seat) {
    seat.currentEmployeeId = params.employeeId;
    seat.status = "occupied";
  }
  store.bindings[`bind-${params.employeeId}`] = {
    bindingId: `bind-${params.employeeId}`,
    tenantId: "acme",
    seatId,
    employeeId: params.employeeId,
    bindingStatus: "active",
    effectiveAt: NOW,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveWithGovernanceMock.mockResolvedValue(undefined);
  resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(new Error("no session"));
  executeActionMock.mockReset();
});

describe("PEP: collaborationOwnerEntitlement → enforce → high + zero enroll", () => {
  it("denies high-risk with OWNER_GRANT_REQUIRED on collaboration-owner scope", async () => {
    const store = createStore();
    const identityId = seedWechatHighRiskIdentity(store);
    bindOwnerToSeat(store);
    loadEnterpriseSeatAssetsStoreMock.mockImplementation(async () => store);

    const enforcement = await enforceOperationalIdentityRuntimeAccess({
      client: null,
      identityId,
      action: "publish_article",
      agentId: "agent-1",
      collaborationOwnerEntitlement: {
        tenantId: "acme",
        seatId: "seat-1",
        employeeId: "owner-emp",
        stillGroupOwner: true,
      },
    });

    expect(enforcement.ok).toBe(false);
    expect(enforcement.source).toBe("collaboration-owner");
    expect(enforcement.result?.allowed).toBe(false);
    if (enforcement.result && !enforcement.result.allowed) {
      expect(enforcement.result.code).toBe("OWNER_GRANT_REQUIRED");
    }
    expect(executeActionMock).not.toHaveBeenCalled();
  });
});

describe("PEP: execute-path authz-denial audit", () => {
  it("records identity.usage_denied even when enforce runs with audit:false", async () => {
    const store = createStore();
    const identityId = seedWechatHighRiskIdentity(store);
    bindOwnerToSeat(store);
    loadEnterpriseSeatAssetsStoreMock.mockImplementation(async () => store);

    const result = await executeEnterpriseOperationalIdentityRuntimeAction({
      client: null,
      identityId,
      action: "publish_article",
      agentId: "agent-1",
      collaborationOwnerEntitlement: {
        tenantId: "acme",
        seatId: "seat-1",
        employeeId: "owner-emp",
        stillGroupOwner: true,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("OWNER_GRANT_REQUIRED");
    }
    expect(executeActionMock).not.toHaveBeenCalled();

    const deniedEvents = Object.values(store.auditEvents).filter(
      (event) => event.eventType === "identity.usage_denied",
    );
    expect(deniedEvents.length).toBeGreaterThanOrEqual(1);
    const denial = deniedEvents[0];
    expect(denial?.resourceId).toBe(identityId);
    expect(denial?.metadata?.code).toBe("OWNER_GRANT_REQUIRED");
    expect(denial?.metadata?.action).toBe("publish_article");
    expect(denial?.metadata?.agentId).toBe("agent-1");
    // Audit meta closure: PDP decision.meta must land on usage_denied.
    expect(denial?.metadata?.tenantGrantMode).toBe("seat_inherit_until_curated");
    expect(denial?.metadata?.risk).toBe("high");
    expect(saveWithGovernanceMock).toHaveBeenCalled();
  });

  it("closes policyVersion / grantMode meta on enforce deny+allow audit paths", async () => {
    const store = createStore();
    const identityId = seedWechatHighRiskIdentity(store);
    const policy = Object.values(store.identityUsagePolicies).find(
      (entry) => entry.identityId === identityId,
    );
    // Narrow policy first so a later expansion is a material version bump.
    upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId,
      policyId: policy?.policyId,
      seatIds: ["seat-1"],
      allowedAgentIds: [],
      allowedActions: ["publish_draft"],
      nowIso: NOW,
    });
    const narrowed = Object.values(store.identityUsagePolicies).find(
      (entry) => entry.identityId === identityId,
    );
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "owner-emp",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_draft"],
      nowIso: NOW,
      status: "active",
      grantMode: "explicit_owner_grant",
      policyVersionAtGrant: narrowed?.policyVersion ?? "1",
    });
    // Material expansion bumps policyVersion; publish_article then mismatches grant snapshot.
    upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId,
      policyId: narrowed?.policyId,
      seatIds: ["seat-1"],
      allowedAgentIds: [],
      allowedActions: ["publish_draft", "publish_article", "broadcast_article"],
      nowIso: NOW,
    });
    const expanded = Object.values(store.identityUsagePolicies).find(
      (entry) => entry.identityId === identityId,
    );
    const grantVersion = narrowed?.policyVersion ?? "1";
    const currentVersion = expanded?.policyVersion ?? "2";
    expect(currentVersion).not.toBe(grantVersion);
    bindOwnerToSeat(store);
    loadEnterpriseSeatAssetsStoreMock.mockImplementation(async () => store);

    const denied = await enforceOperationalIdentityRuntimeAccess({
      client: null,
      identityId,
      action: "publish_article",
      agentId: "agent-1",
      audit: true,
      collaborationOwnerEntitlement: {
        tenantId: "acme",
        seatId: "seat-1",
        employeeId: "owner-emp",
        stillGroupOwner: true,
      },
    });
    expect(denied.ok).toBe(false);
    if (denied.result && !denied.result.allowed) {
      expect(denied.result.code).toBe("OWNER_GRANT_POLICY_VERSION_MISMATCH");
      expect(denied.result.meta?.policyVersion).toBe(currentVersion);
      expect(denied.result.meta?.policyVersionAtGrant).toBe(grantVersion);
      expect(denied.result.meta?.grantMode).toBe("explicit_owner_grant");
      expect(denied.result.meta?.grantStatus).toBe("active");
      expect(denied.result.meta?.enrollmentId).toBeTruthy();
      expect(denied.result.meta?.risk).toBe("high");
      expect(denied.result.meta?.tenantGrantMode).toBeTruthy();
      expect(denied.result.meta?.stage).toBe("runtime_decision");
      expect(denied.result.meta?.scopeSource).toBe("collaboration-owner");
    }
    const deniedEvent = Object.values(store.auditEvents).find(
      (event) =>
        event.eventType === "identity.usage_denied" &&
        event.metadata?.code === "OWNER_GRANT_POLICY_VERSION_MISMATCH",
    );
    expect(deniedEvent?.metadata?.policyVersion).toBe(currentVersion);
    expect(deniedEvent?.metadata?.policyVersionAtGrant).toBe(grantVersion);
    expect(deniedEvent?.metadata?.grantMode).toBe("explicit_owner_grant");
    expect(deniedEvent?.metadata?.grantStatus).toBe("active");
    expect(deniedEvent?.metadata?.enrollmentId).toBeTruthy();
    expect(deniedEvent?.metadata?.risk).toBe("high");
    expect(deniedEvent?.metadata?.tenantGrantMode).toBeTruthy();
    expect(deniedEvent?.metadata?.stage).toBe("runtime_decision");
    expect(deniedEvent?.metadata?.scopeSource).toBe("collaboration-owner");

    const allowed = await enforceOperationalIdentityRuntimeAccess({
      client: null,
      identityId,
      action: "publish_draft",
      agentId: "agent-1",
      audit: true,
      collaborationOwnerEntitlement: {
        tenantId: "acme",
        seatId: "seat-1",
        employeeId: "owner-emp",
      },
    });
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.result.meta.policyVersion).toBe(currentVersion);
      expect(allowed.result.meta.policyVersionAtGrant).toBe(grantVersion);
      expect(allowed.result.meta.grantMode).toBe("explicit_owner_grant");
      expect(allowed.result.meta.grantStatus).toBe("active");
      expect(allowed.result.meta.enrollmentId).toBeTruthy();
      expect(allowed.result.meta.risk).toBe("low");
    }
    const usedEvent = Object.values(store.auditEvents).find(
      (event) => event.eventType === "identity.used" && event.metadata?.action === "publish_draft",
    );
    expect(usedEvent?.metadata?.policyVersion).toBe(currentVersion);
    expect(usedEvent?.metadata?.policyVersionAtGrant).toBe(grantVersion);
    expect(usedEvent?.metadata?.grantMode).toBe("explicit_owner_grant");
    expect(usedEvent?.metadata?.grantStatus).toBe("active");
    expect(usedEvent?.metadata?.enrollmentId).toBeTruthy();
    expect(usedEvent?.metadata?.risk).toBe("low");
    expect(usedEvent?.metadata?.tenantGrantMode).toBeTruthy();
  });

  it("closes AGENT_NOT_MANAGEABLE meta into usage_denied audit", async () => {
    const store = createStore();
    const identityId = seedWechatHighRiskIdentity(store);
    // Agent not in seat's defaultAgentAssetIds / grants → not manageable.
    store.seats["seat-1"].defaultAgentAssetIds = ["other-agent"];
    loadEnterpriseSeatAssetsStoreMock.mockImplementation(async () => store);

    const denied = await enforceOperationalIdentityRuntimeAccess({
      client: null,
      identityId,
      action: "publish_draft",
      agentId: "agent-1",
      audit: true,
      collaborationOwnerEntitlement: {
        tenantId: "acme",
        seatId: "seat-1",
        employeeId: "owner-emp",
      },
    });
    expect(denied.ok).toBe(false);
    if (denied.result && !denied.result.allowed) {
      expect(denied.result.code).toBe("AGENT_NOT_MANAGEABLE");
    }
    const deniedEvent = Object.values(store.auditEvents).find(
      (event) =>
        event.eventType === "identity.usage_denied" &&
        event.metadata?.code === "AGENT_NOT_MANAGEABLE",
    );
    expect(deniedEvent?.metadata?.tenantGrantMode).toBeTruthy();
    expect(deniedEvent?.metadata?.code).toBe("AGENT_NOT_MANAGEABLE");
  });
});
