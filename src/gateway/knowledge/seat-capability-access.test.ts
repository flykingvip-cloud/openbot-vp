// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { decideGovernanceApprovalRequest } from "../enterprise-data/governance-approval-store.js";
import { findSeatActionGrant } from "../enterprise-data/seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../enterprise-data/store.js";
import {
  buildSeatCapabilitySubjectId,
  createSeatCapabilityAccessRequest,
  grantDataCapabilityToSeat,
  hasPendingSeatCapabilityAccess,
} from "./seat-capability-access.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-12T12:00:00.000Z";

describe("seat capability access workflow", () => {
  it("creates governance approval and grants seat actions on approve", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.tenantId === tenantId && item.capabilityKey === "sales.churn-risk",
    )!;
    const seatId = "seat-sales-mgr-east";

    const approval = createSeatCapabilityAccessRequest({
      store,
      tenantId,
      seatId,
      capabilityId: capability.capabilityId,
      capabilityTitle: capability.displayName,
      requestedBy: seatId,
      nowIso,
    });

    expect(approval.category).toBe("seat_capability_access");
    expect(approval.subjectId).toBe(buildSeatCapabilitySubjectId(seatId, capability.capabilityId));
    expect(
      hasPendingSeatCapabilityAccess({
        store,
        tenantId,
        seatId,
        capabilityId: capability.capabilityId,
      }),
    ).toBe(true);

    decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: approval.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      nowIso,
    });

    for (const ref of capability.actionRefs) {
      expect(findSeatActionGrant(store, tenantId, seatId, ref)).not.toBeNull();
    }
    expect(
      hasPendingSeatCapabilityAccess({
        store,
        tenantId,
        seatId,
        capabilityId: capability.capabilityId,
      }),
    ).toBe(false);
  });

  it("rejects duplicate pending requests for the same seat and capability", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.tenantId === tenantId,
    )!;
    const seatId = "seat-sales-mgr-east";
    createSeatCapabilityAccessRequest({
      store,
      tenantId,
      seatId,
      capabilityId: capability.capabilityId,
      capabilityTitle: capability.displayName,
      requestedBy: seatId,
      nowIso,
    });
    expect(() =>
      createSeatCapabilityAccessRequest({
        store,
        tenantId,
        seatId,
        capabilityId: capability.capabilityId,
        capabilityTitle: capability.displayName,
        requestedBy: seatId,
        nowIso,
      }),
    ).toThrow(EnterpriseDataStoreError);
  });

  it("grants capability directly for admin proactive authorization", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const capability = Object.values(store.dataCapabilities).find(
      (item) => item.tenantId === tenantId && item.capabilityKey === "sales.churn-risk",
    )!;
    const seatId = "seat-sales-mgr-east";
    const count = grantDataCapabilityToSeat({
      store,
      tenantId,
      seatId,
      capabilityId: capability.capabilityId,
      nowIso,
    });
    expect(count).toBe(capability.actionRefs.length);
    expect(findSeatActionGrant(store, tenantId, seatId, capability.actionRefs[0])).not.toBeNull();
  });
});
