// @vitest-environment node
/**
 * P2: collaboration-owner live revalidation (high fail-closed), audit stage/scopeSource,
 * and optional CollaborationIdentityDelegation narrowing via the same PDP.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerEnterpriseIdentity,
  upsertCollaborationIdentityDelegation,
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
  computeEffectiveAccess,
  computeEffectiveAccessEntries,
  enforceOperationalIdentityRuntimeAccess,
  formatOperationalIdentityRuntimePrompt,
  revalidateCollaborationOwnerLive,
} = await import("./enterprise-operational-identity-runtime.js");

const NOW = "2026-09-25T04:00:00.000Z";

function createStore(): EnterpriseSeatAssetsStore {
  return normalizeEnterpriseSeatAssetsStore(null, 4);
}

function seedWechatIdentity(
  store: EnterpriseSeatAssetsStore,
  params?: { policyActions?: string[]; capabilities?: string[] },
): string {
  store.seats["seat-1"] = {
    seatId: "seat-1",
    tenantId: "acme",
    title: "Ops",
    status: "occupied",
    currentEmployeeId: "owner-emp",
    defaultSpaceIds: [],
    defaultAgentAssetIds: ["agent-1"],
    createdAt: NOW,
    updatedAt: NOW,
  };
  store.bindings["bind-owner"] = {
    bindingId: "bind-owner",
    tenantId: "acme",
    seatId: "seat-1",
    employeeId: "owner-emp",
    bindingStatus: "active",
    effectiveAt: NOW,
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
  if (params?.capabilities) {
    const row = store.enterpriseIdentities[identity.identity.identityId];
    if (row) {
      row.capabilities = params.capabilities;
    }
  }
  upsertIdentityUsagePolicy({
    store,
    tenantId: "acme",
    identityId: identity.identity.identityId,
    seatIds: ["seat-1"],
    allowedAgentIds: [],
    allowedActions: params?.policyActions ?? [
      "publish_draft",
      "upload_thumb",
      "publish_article",
      "broadcast_article",
    ],
    nowIso: NOW,
  });
  return identity.identity.identityId;
}

const ownerEntitlement = {
  tenantId: "acme",
  seatId: "seat-1",
  employeeId: "owner-emp",
  collaborationGroupId: "group-1",
  stillGroupOwner: true as boolean | undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  saveWithGovernanceMock.mockResolvedValue(undefined);
  resolveTrustedEnterpriseDataExecutionContextMock.mockRejectedValue(new Error("no session"));
});

describe("P2 collaboration-owner live revalidation", () => {
  it("fail-closed: high + collaboration-owner + unbound seat → COLLABORATION_OWNER_REVALIDATION_FAILED", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    // Revoke live binding.
    store.bindings["bind-owner"].bindingStatus = "revoked";
    store.seats["seat-1"].currentEmployeeId = undefined;

    const live = revalidateCollaborationOwnerLive({
      store,
      entitlement: ownerEntitlement,
    });
    expect(live.ok).toBe(false);

    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "owner-emp",
      identityId,
      action: "publish_article",
      nowIso: NOW,
      scopeSource: "collaboration-owner",
      collaborationOwnerLive: live,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("COLLABORATION_OWNER_REVALIDATION_FAILED");
      expect(decision.meta?.stage).toBe("runtime_decision");
      expect(decision.meta?.scopeSource).toBe("collaboration-owner");
      expect(decision.meta?.risk).toBe("high");
      expect(decision.meta?.revalidationReason).toBeTruthy();
    }
  });

  it("fail-closed: stillGroupOwner=false → Deny even with binding", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "owner-emp",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article", "publish_draft"],
      nowIso: NOW,
    });
    const live = revalidateCollaborationOwnerLive({
      store,
      entitlement: { ...ownerEntitlement, stillGroupOwner: false },
    });
    expect(live.ok).toBe(false);
    if (!live.ok) {
      expect(live.reason).toBe("not_group_owner");
    }
    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "owner-emp",
      identityId,
      action: "publish_article",
      nowIso: NOW,
      scopeSource: "collaboration-owner",
      collaborationOwnerLive: live,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("COLLABORATION_OWNER_REVALIDATION_FAILED");
    }
  });

  it("high + collaboration-owner: revalidation pass → same PDP (enrollment/high rules)", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    const live = revalidateCollaborationOwnerLive({
      store,
      entitlement: ownerEntitlement,
    });
    expect(live.ok).toBe(true);

    // Zero enrollment → OWNER_GRANT_REQUIRED (same as employee path).
    const denied = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "owner-emp",
      identityId,
      action: "publish_article",
      nowIso: NOW,
      scopeSource: "collaboration-owner",
      collaborationOwnerLive: live,
    });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.code).toBe("OWNER_GRANT_REQUIRED");
      expect(denied.meta?.stage).toBe("runtime_decision");
      expect(denied.meta?.scopeSource).toBe("collaboration-owner");
      expect(denied.meta?.risk).toBe("high");
    }

    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "owner-emp",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article", "publish_draft"],
      nowIso: NOW,
    });
    const allowed = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "owner-emp",
      identityId,
      action: "publish_article",
      nowIso: NOW,
      scopeSource: "collaboration-owner",
      collaborationOwnerLive: live,
    });
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) {
      expect(allowed.meta.stage).toBe("runtime_decision");
      expect(allowed.meta.scopeSource).toBe("collaboration-owner");
      expect(allowed.meta.risk).toBe("high");
      expect(allowed.meta.enrollmentId).toBeTruthy();
    }
  });

  it("enforce path: unbound owner → usage_denied with stage/scopeSource/revalidationReason", async () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    store.bindings["bind-owner"].bindingStatus = "revoked";
    loadEnterpriseSeatAssetsStoreMock.mockImplementation(async () => store);

    const enforcement = await enforceOperationalIdentityRuntimeAccess({
      client: null,
      identityId,
      action: "publish_article",
      agentId: "agent-1",
      collaborationOwnerEntitlement: ownerEntitlement,
    });
    expect(enforcement.ok).toBe(false);
    expect(enforcement.source).toBe("collaboration-owner");
    if (enforcement.result && !enforcement.result.allowed) {
      expect(enforcement.result.code).toBe("COLLABORATION_OWNER_REVALIDATION_FAILED");
      expect(enforcement.result.meta?.stage).toBe("runtime_decision");
      expect(enforcement.result.meta?.scopeSource).toBe("collaboration-owner");
      expect(enforcement.result.meta?.risk).toBe("high");
    }
    const deniedEvent = Object.values(store.auditEvents).find(
      (event) => event.eventType === "identity.usage_denied",
    );
    expect(deniedEvent?.metadata?.code).toBe("COLLABORATION_OWNER_REVALIDATION_FAILED");
    expect(deniedEvent?.metadata?.stage).toBe("runtime_decision");
    expect(deniedEvent?.metadata?.scopeSource).toBe("collaboration-owner");
    expect(deniedEvent?.metadata?.risk).toBe("high");
    expect(deniedEvent?.metadata?.revalidationReason).toBeTruthy();
  });
});

describe("P2 CollaborationIdentityDelegation narrowing", () => {
  it("narrows list/prompt/enforce consistently; zero delegation does not regress", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "owner-emp",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article", "publish_draft", "upload_thumb"],
      nowIso: NOW,
    });
    const live = revalidateCollaborationOwnerLive({
      store,
      entitlement: ownerEntitlement,
    });
    expect(live.ok).toBe(true);

    // Zero delegation: full enrolled set (minus nothing).
    const before = computeEffectiveAccessEntries({
      store,
      scope: {
        tenantId: "acme",
        seatId: "seat-1",
        agentId: "agent-1",
        employeeId: "owner-emp",
      },
      nowIso: NOW,
      scopeSource: "collaboration-owner",
      collaborationOwnerLive: live,
      collaborationGroupId: "group-1",
    });
    expect(before[0]?.allowedActions).toEqual(["publish_article", "publish_draft", "upload_thumb"]);

    upsertCollaborationIdentityDelegation({
      store,
      tenantId: "acme",
      collaborationGroupId: "group-1",
      ownerEmployeeId: "owner-emp",
      agentId: "agent-1",
      identityId,
      // Narrower than enrollment: drop publish_article + upload_thumb.
      allowedActions: ["publish_draft"],
      nowIso: NOW,
    });

    const after = computeEffectiveAccessEntries({
      store,
      scope: {
        tenantId: "acme",
        seatId: "seat-1",
        agentId: "agent-1",
        employeeId: "owner-emp",
      },
      nowIso: NOW,
      scopeSource: "collaboration-owner",
      collaborationOwnerLive: live,
      collaborationGroupId: "group-1",
    });
    expect(after[0]?.allowedActions).toEqual(["publish_draft"]);

    const prompt = formatOperationalIdentityRuntimePrompt(after);
    expect(prompt).toContain("publish_draft");
    expect(prompt).not.toContain("publish_article");
    expect(prompt).not.toContain("upload_thumb");
    // Projection ban: no stage/risk/enrollment/denial-code rule prose.
    expect(prompt ?? "").not.toMatch(
      /runtime_decision|scopeSource|OWNER_GRANT|enrollmentId|risk=high|CollaborationIdentityDelegation/i,
    );

    const allowDraft = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "owner-emp",
      identityId,
      action: "publish_draft",
      nowIso: NOW,
      scopeSource: "collaboration-owner",
      collaborationOwnerLive: live,
      collaborationDelegationActions: ["publish_draft"],
      collaborationDelegationId: "deleg-1",
    });
    expect(allowDraft.allowed).toBe(true);

    const denyArticle = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "owner-emp",
      identityId,
      action: "publish_article",
      nowIso: NOW,
      scopeSource: "collaboration-owner",
      collaborationOwnerLive: live,
      collaborationDelegationActions: ["publish_draft"],
    });
    expect(denyArticle.allowed).toBe(false);
    if (!denyArticle.allowed) {
      expect(denyArticle.code).toBe("OWNER_GRANT_ACTION_DENIED");
      expect(denyArticle.meta?.stage).toBe("runtime_decision");
      expect(denyArticle.meta?.scopeSource).toBe("collaboration-owner");
    }
  });
});

describe("P2 audit meta stage/scopeSource on employee path", () => {
  it("includes stage on employee PDP decisions; prompt stays free of audit fields", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "owner-emp",
      identityId,
      action: "publish_draft",
      nowIso: NOW,
      scopeSource: "employee",
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.meta.stage).toBe("runtime_decision");
      expect(decision.meta.scopeSource).toBe("employee");
      expect(decision.meta.risk).toBe("low");
    }
    const entries = computeEffectiveAccessEntries({
      store,
      scope: {
        tenantId: "acme",
        seatId: "seat-1",
        agentId: "agent-1",
        employeeId: "owner-emp",
      },
      nowIso: NOW,
      scopeSource: "employee",
    });
    const prompt = formatOperationalIdentityRuntimePrompt(entries);
    expect(prompt ?? "").not.toMatch(/runtime_decision|scopeSource|enrollmentId|risk=|stage/i);
  });
});
