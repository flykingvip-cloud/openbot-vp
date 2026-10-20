// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  computeEffectiveAccess,
  computeEffectiveAccessEntries,
  computeEffectiveActions,
  formatOperationalIdentityRuntimePrompt,
  previewOperationalIdentityImplicitInheritExitDelta,
  updateOperationalIdentityTenantGrantMode,
} from "./enterprise-operational-identity-runtime.js";
import {
  registerEnterpriseIdentity,
  removeEmployeeEnterpriseIdentityEnrollment,
  upsertEmployeeEnterpriseIdentityEnrollment,
  upsertIdentityUsagePolicy,
} from "./enterprise-operational-identity-store.js";
import { normalizeEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-backend.js";
import {
  registerConnectorCredentialBinding,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

const NOW = "2026-09-25T02:00:00.000Z";

function createStore(): EnterpriseSeatAssetsStore {
  return normalizeEnterpriseSeatAssetsStore(null, 4);
}

function seedWechatIdentity(
  store: EnterpriseSeatAssetsStore,
  params?: { capabilities?: string[]; policyActions?: string[] },
): string {
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

describe("P1 policyVersion / policyVersionAtGrant", () => {
  it("denies expanded actions after policy version bump with OWNER_GRANT_POLICY_VERSION_MISMATCH", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store, {
      policyActions: ["publish_draft", "upload_thumb"],
    });
    const policy = Object.values(store.identityUsagePolicies).find(
      (entry) => entry.identityId === identityId,
    );
    expect(policy?.policyVersion).toBe("1");

    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_draft", "upload_thumb"],
      nowIso: NOW,
      status: "active",
      grantMode: "explicit_owner_grant",
      policyVersionAtGrant: policy?.policyVersion ?? "1",
    });

    // Material policy expansion bumps version (same policyId).
    upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId,
      policyId: policy?.policyId,
      seatIds: ["seat-1"],
      allowedAgentIds: [],
      allowedActions: ["publish_draft", "upload_thumb", "publish_article"],
      nowIso: NOW,
    });
    const bumped = Object.values(store.identityUsagePolicies).find(
      (entry) => entry.identityId === identityId,
    );
    expect(bumped?.policyVersion).toBe("2");

    const denied = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_article",
      nowIso: NOW,
    });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.code).toBe("OWNER_GRANT_POLICY_VERSION_MISMATCH");
      expect(denied.meta?.policyVersion).toBe("2");
      expect(denied.meta?.policyVersionAtGrant).toBe("1");
    }

    // Still-granted action remains allowed; meta carries versions for audit (not prompt).
    const allowed = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_draft",
      nowIso: NOW,
    });
    expect(allowed.allowed).toBe(true);
    if (allowed.allowed) {
      expect(allowed.meta.policyVersion).toBe("2");
      expect(allowed.meta.policyVersionAtGrant).toBe("1");
    }

    const prompt = formatOperationalIdentityRuntimePrompt(
      computeEffectiveAccessEntries({
        store,
        scope: {
          tenantId: "acme",
          seatId: "seat-1",
          agentId: "agent-1",
          employeeId: "emp-1",
        },
        nowIso: NOW,
      }),
    );
    expect(prompt ?? "").not.toMatch(/policyVersion|POLICY_VERSION|grantMode|enrollment/i);
  });
});

describe("P1 grantMode / status effects", () => {
  it("treats suspended grant as inactive (OWNER_GRANT_INACTIVE)", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article", "publish_draft"],
      nowIso: NOW,
      status: "suspended",
      grantMode: "explicit_owner_grant",
      policyVersionAtGrant: "1",
    });
    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_article",
      nowIso: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("OWNER_GRANT_INACTIVE");
      expect(decision.meta?.grantStatus).toBe("suspended");
    }
  });

  it("active explicit_owner_grant enrollment restores high-risk allow", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article"],
      nowIso: NOW,
      status: "active",
      grantMode: "explicit_owner_grant",
      policyVersionAtGrant: "1",
    });
    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_article",
      nowIso: NOW,
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.meta.grantMode).toBe("explicit_owner_grant");
    }
  });
});

describe("P1 tenant switch exits implicit inheritance", () => {
  it("explicit_owner_grant denies low-risk zero-enrollment that seat-inherit would allow", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);

    const before = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_draft",
      nowIso: NOW,
    });
    expect(before.allowed).toBe(true);

    const delta = previewOperationalIdentityImplicitInheritExitDelta({
      store,
      tenantId: "acme",
    });
    expect(delta.some((row) => row.agentId === "agent-1" && row.seatId === "seat-1")).toBe(true);

    updateOperationalIdentityTenantGrantMode({
      store,
      tenantId: "acme",
      grantMode: "explicit_owner_grant",
      nowIso: NOW,
    });

    const after = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_draft",
      nowIso: NOW,
    });
    expect(after.allowed).toBe(false);
    if (!after.allowed) {
      expect(after.code).toBe("OWNER_GRANT_REQUIRED");
      expect(after.meta?.tenantGrantMode).toBe("explicit_owner_grant");
    }

    expect(
      computeEffectiveActions({
        provider: "wechat-official",
        policyActions: ["publish_draft", "publish_article"],
        enrollmentActions: null,
        agentHasEnrollments: false,
        tenantGrantMode: "explicit_owner_grant",
      }),
    ).toEqual([]);
  });
});

describe("P1 agent ownership re-check at execute", () => {
  it("denies AGENT_NOT_MANAGEABLE when agent leaves the seat grant set", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_draft", "publish_article"],
      nowIso: NOW,
      status: "active",
      grantMode: "explicit_owner_grant",
      policyVersionAtGrant: "1",
    });

    const allowed = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_draft",
      nowIso: NOW,
    });
    expect(allowed.allowed).toBe(true);

    // Agent removed from seat manageability set.
    store.seats["seat-1"].defaultAgentAssetIds = ["agent-other"];

    const denied = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_draft",
      nowIso: NOW,
    });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.code).toBe("AGENT_NOT_MANAGEABLE");
    }
  });
});

describe("P1 revoke soft-status", () => {
  it("revoke sets status=revoked and PDP returns OWNER_GRANT_INACTIVE", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article", "publish_draft"],
      nowIso: NOW,
      status: "active",
      grantMode: "explicit_owner_grant",
      policyVersionAtGrant: "1",
    });
    const removed = removeEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      nowIso: NOW,
    });
    expect(removed).toBe(true);
    const row = Object.values(store.employeeIdentityEnrollments).find(
      (entry) => entry.identityId === identityId,
    );
    expect(row?.status).toBe("revoked");

    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_article",
      nowIso: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("OWNER_GRANT_INACTIVE");
      expect(decision.meta?.grantStatus).toBe("revoked");
      expect(decision.meta?.grantMode).toBe("explicit_owner_grant");
    }
  });
});
