// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { decideGovernanceApprovalRequest } from "../enterprise-data/governance-approval-store.js";
import {
  evaluateKnowledgeVisibility,
  listKnowledgeVisibilityPolicies,
} from "../enterprise-data/knowledge-visibility-policy-store.js";
import { seedEnterpriseDataCatalog } from "../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../enterprise-data/store.js";
import {
  buildEnterpriseKnowledgeAccessSubjectId,
  createEnterpriseKnowledgeAccessRequest,
  grantEnterpriseKnowledgeAccessToSeat,
  hasPendingEnterpriseKnowledgeAccess,
  isEnterpriseKnowledgeAccessGranted,
  parseEnterpriseKnowledgeAccessSubjectId,
} from "./enterprise-knowledge-access-request.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-12T12:00:00.000Z";

function profileProjectionId(store: ReturnType<typeof normalizeEnterpriseDataStore>): string {
  const projection = Object.values(store.enterpriseKnowledgeProjectionSpecs).find(
    (item) => item.tenantId === tenantId && item.objectKind === "data",
  );
  if (!projection) {
    throw new Error("missing seeded profile projection");
  }
  return projection.projectionId;
}

describe("enterprise knowledge access workflow", () => {
  it("parses ekp subject ids", () => {
    expect(parseEnterpriseKnowledgeAccessSubjectId("ekp:seat-a:proj-1")).toEqual({
      seatId: "seat-a",
      projectionId: "proj-1",
    });
    expect(parseEnterpriseKnowledgeAccessSubjectId("ekp:seat-a")).toBeNull();
    expect(parseEnterpriseKnowledgeAccessSubjectId("seat-capability:x::y")).toBeNull();
  });

  it("creates governance approval and grants seat visibility on approve", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const projectionId = profileProjectionId(store);
    const seatId = "seat-outsider";

    expect(isEnterpriseKnowledgeAccessGranted({ store, tenantId, seatId, projectionId })).toBe(
      false,
    );

    const approval = createEnterpriseKnowledgeAccessRequest({
      store,
      tenantId,
      seatId,
      projectionId,
      projectionTitle: "客户画像",
      requestedBy: seatId,
      nowIso,
    });

    expect(approval.category).toBe("enterprise_knowledge_access");
    expect(approval.subjectId).toBe(buildEnterpriseKnowledgeAccessSubjectId(seatId, projectionId));
    expect(hasPendingEnterpriseKnowledgeAccess({ store, tenantId, seatId, projectionId })).toBe(
      true,
    );

    decideGovernanceApprovalRequest({
      store,
      tenantId,
      approvalId: approval.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      nowIso,
    });

    expect(hasPendingEnterpriseKnowledgeAccess({ store, tenantId, seatId, projectionId })).toBe(
      false,
    );
    expect(isEnterpriseKnowledgeAccessGranted({ store, tenantId, seatId, projectionId })).toBe(
      true,
    );

    const policies = listKnowledgeVisibilityPolicies({ store, tenantId, projectionId });
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(evaluateKnowledgeVisibility({ policy, context: { seatId } })).toBe(true);
    }
  });

  it("rejects duplicate pending requests for the same seat and projection", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const projectionId = profileProjectionId(store);
    const seatId = "seat-outsider";
    createEnterpriseKnowledgeAccessRequest({
      store,
      tenantId,
      seatId,
      projectionId,
      projectionTitle: "客户画像",
      requestedBy: seatId,
      nowIso,
    });
    expect(() =>
      createEnterpriseKnowledgeAccessRequest({
        store,
        tenantId,
        seatId,
        projectionId,
        projectionTitle: "客户画像",
        requestedBy: seatId,
        nowIso,
      }),
    ).toThrow(EnterpriseDataStoreError);
  });

  it("grants visibility directly for admin proactive authorization", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const projectionId = profileProjectionId(store);
    const seatId = "seat-proactive";
    const written = grantEnterpriseKnowledgeAccessToSeat({
      store,
      tenantId,
      seatId,
      projectionId,
      nowIso,
    });
    expect(written).toBeGreaterThan(0);
    expect(isEnterpriseKnowledgeAccessGranted({ store, tenantId, seatId, projectionId })).toBe(
      true,
    );
  });

  it("creates a seat-only policy when the projection has no visibility policy", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    // Churn projection is seeded without a visibility policy.
    const churn = Object.values(store.enterpriseKnowledgeProjectionSpecs).find(
      (item) => item.tenantId === tenantId && item.objectKind === "insight",
    );
    if (!churn) {
      throw new Error("missing seeded churn projection");
    }
    expect(
      listKnowledgeVisibilityPolicies({
        store,
        tenantId,
        projectionId: churn.projectionId,
      }),
    ).toHaveLength(0);

    grantEnterpriseKnowledgeAccessToSeat({
      store,
      tenantId,
      seatId: "seat-new",
      projectionId: churn.projectionId,
      nowIso,
    });

    const policies = listKnowledgeVisibilityPolicies({
      store,
      tenantId,
      projectionId: churn.projectionId,
    });
    expect(policies).toHaveLength(1);
    expect(policies[0]?.visibleSeats).toContain("seat-new");
  });
});
