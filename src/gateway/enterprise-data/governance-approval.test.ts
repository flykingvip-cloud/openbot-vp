// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { compileDataAccessPolicy } from "./data-access-policy-store.js";
import {
  createGovernanceApprovalRequest,
  decideGovernanceApprovalRequest,
  listGovernanceApprovalRequests,
  resolveGovernanceApprovalCenterOverview,
} from "./governance-approval-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("governance approval center M5", () => {
  it("separates approval categories and applies effects on approve", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const source = Object.values(store.dataSources).find((item) => item.tenantId === tenantId)!;
    source.status = "disconnected";
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.tenantId === tenantId && item.capabilityKey === "sales.churn-risk",
    )!;
    capability.enabled = false;
    const accessPolicy = Object.values(store.dataAccessPolicies).find(
      (item) => item.tenantId === tenantId,
    )!;
    for (const grantId of accessPolicy.compiledGrantIds) {
      const grant = store.seatActionGrants[grantId];
      if (grant) {
        grant.revokedAt = nowIso;
      }
    }
    accessPolicy.compiledGrantIds = [];

    const sourceApproval = createGovernanceApprovalRequest({
      store,
      tenantId,
      category: "source_onboarding",
      subjectId: source.sourceId,
      requestedBy: "emp-admin-001",
      nowIso,
    });
    const accessApproval = createGovernanceApprovalRequest({
      store,
      tenantId,
      category: "data_access",
      subjectId: accessPolicy.policyId,
      requestedBy: "emp-admin-001",
      nowIso,
    });
    const capabilityApproval = createGovernanceApprovalRequest({
      store,
      tenantId,
      category: "capability_exposure",
      subjectId: capability.capabilityId,
      requestedBy: "emp-admin-001",
      nowIso,
    });

    const onboardingOnly = listGovernanceApprovalRequests({
      store,
      tenantId,
      category: "source_onboarding",
      status: "pending",
    });
    const accessOnly = listGovernanceApprovalRequests({
      store,
      tenantId,
      category: "data_access",
      status: "pending",
    });
    const exposureOnly = listGovernanceApprovalRequests({
      store,
      tenantId,
      category: "capability_exposure",
      status: "pending",
    });
    expect(onboardingOnly.map((request) => request.category)).toEqual(["source_onboarding"]);
    expect(accessOnly.map((request) => request.category)).toEqual(["data_access"]);
    expect(exposureOnly.map((request) => request.category)).toEqual(["capability_exposure"]);

    decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: sourceApproval.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-002",
      nowIso,
    });
    decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: accessApproval.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-002",
      nowIso,
    });
    decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: capabilityApproval.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-002",
      nowIso,
    });

    expect(source.status).toBe("connected");
    expect(capability.enabled).toBe(true);
    const compiled = compileDataAccessPolicy({
      store,
      tenantId,
      policyId: accessPolicy.policyId,
      nowIso,
    });
    expect(compiled.grants.length).toBeGreaterThan(0);

    const overview = resolveGovernanceApprovalCenterOverview({ store, tenantId });
    expect(overview.totalPending).toBe(0);
    expect(overview.pendingByCategory.source_onboarding).toBe(0);
    expect(overview.pendingByCategory.data_access).toBe(0);
    expect(overview.pendingByCategory.capability_exposure).toBe(0);
  });

  it("rejects duplicate pending approvals for the same subject", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const source = Object.values(store.dataSources).find((item) => item.tenantId === tenantId)!;
    createGovernanceApprovalRequest({
      store,
      tenantId,
      category: "source_onboarding",
      subjectId: source.sourceId,
      requestedBy: "emp-admin-001",
      nowIso,
    });
    try {
      createGovernanceApprovalRequest({
        store,
        tenantId,
        category: "source_onboarding",
        subjectId: source.sourceId,
        requestedBy: "emp-admin-001",
        nowIso,
      });
      expect.fail("expected duplicate pending approval to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(EnterpriseDataStoreError);
      expect((error as EnterpriseDataStoreError).code).toBe("GOVERNANCE_APPROVAL_DUPLICATE");
    }
  });

  it("supports the identity_binding category (Phase 4.2) end to end", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const request = createGovernanceApprovalRequest({
      store,
      tenantId,
      category: "identity_binding",
      // 身份绑定记录在席位资产库（跨库）；可见名不用 subjectId。
      subjectId: "binding-feishu-001",
      requestedBy: "emp-admin-001",
      nowIso,
    });
    expect(request.category).toBe("identity_binding");
    expect(request.subjectKind).toBe("operational_identity_binding");
    expect(request.displayName).toBe("身份绑定");
    expect(request.subjectId).toBe("binding-feishu-001");

    const overview = resolveGovernanceApprovalCenterOverview({ store, tenantId });
    expect(overview.pendingByCategory.identity_binding).toBe(1);
    expect(overview.totalPending).toBeGreaterThanOrEqual(1);
  });
});
