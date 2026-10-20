import { describe, expect, it } from "vitest";
import type {
  EnterpriseSeatAssetBinding,
  EnterpriseSeatAssetsStore,
  EnterprisePositionSeat,
} from "../enterprise-seat-assets-store.js";
import {
  buildEnterpriseMemoryGovernanceOverview,
  ENTERPRISE_MEMORY_GOVERNANCE_PRIVACY_NOTE,
} from "./enterprise-memory-governance.js";

function emptyStore(): EnterpriseSeatAssetsStore {
  return {
    version: 1,
    seats: {},
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

function makeSeat(tenantId: string): EnterprisePositionSeat {
  const now = "2026-07-20T00:00:00.000Z";
  return {
    seatId: "seat_ops",
    tenantId,
    title: "运营岗",
    defaultSpaceIds: [],
    defaultAgentAssetIds: [],
    status: "assigned",
    createdAt: now,
    updatedAt: now,
  };
}

function makeMemoryBinding(
  id: string,
  tenantId: string,
  assetId: string,
): EnterpriseSeatAssetBinding {
  const now = "2026-07-20T00:00:00.000Z";
  return {
    assetBindingId: id,
    tenantId,
    seatId: "seat_ops",
    assetType: "memory",
    assetId,
    status: "active",
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}

describe("CW2-P6-02 enterprise memory governance overview", () => {
  it("lists org scopes and never includes private transferClass or content", () => {
    const store = emptyStore();
    const tenantId = "tenant_a";
    store.seats.seat_ops = makeSeat(tenantId);
    store.assetBindings.b_org = makeMemoryBinding("b_org", tenantId, "seat:seat_ops");
    store.assetBindings.b_private = makeMemoryBinding(
      "b_private",
      tenantId,
      "employee-private-salary",
    );
    store.assetBindings.b_review = makeMemoryBinding("b_review", tenantId, "project-crm-notes");

    const overview = buildEnterpriseMemoryGovernanceOverview({ store, tenantId });
    expect(overview.privacyNote).toBe(ENTERPRISE_MEMORY_GOVERNANCE_PRIVACY_NOTE);
    expect(overview.seats).toHaveLength(1);
    const classes = overview.seats[0]?.scopes.map((scope) => scope.transferClass) ?? [];
    expect(classes).toContain("inheritable");
    expect(classes).toContain("review_required");
    expect(classes).not.toContain("private");
    expect(overview.seats[0]?.scopes.some((scope) => scope.scopeId.includes("salary"))).toBe(false);

    const json = JSON.stringify(overview);
    expect(json).not.toMatch(/content|summary|atom|transcript|embedding|journal/i);
  });
});
