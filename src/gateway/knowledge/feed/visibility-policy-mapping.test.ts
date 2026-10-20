import { describe, expect, it } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "../../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { seedEnterpriseDataCatalog } from "../../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../enterprise-data/store.js";
import {
  evaluateProjectionVisibility,
  toKnowledgeVisibilityContext,
} from "./visibility-policy-mapping.js";

describe("visibility policy mapping", () => {
  it("maps seat context for visibility evaluation", () => {
    const context = toKnowledgeVisibilityContext({
      tenantId: "tenant-acme",
      seatId: "seat-sales-director",
      userId: "u1",
      teamLabel: "华东销售",
      hasEnterpriseScope: true,
    });
    expect(context?.seatId).toBe("seat-sales-director");
    expect(context?.teamLabel).toBe("华东销售");
    const withOrg = toKnowledgeVisibilityContext({
      tenantId: "tenant-acme",
      seatId: "seat-sales-director",
      userId: "u1",
      roleCode: "sales-mgr",
      departmentId: "sales-mgr:华东销售",
      hasEnterpriseScope: true,
    });
    expect(withOrg?.roleCode).toBe("sales-mgr");
    expect(withOrg?.departmentId).toBe("sales-mgr:华东销售");
  });

  it("evaluates projection visibility by seat and team", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId: "tenant-acme", nowIso: new Date().toISOString() });
    const binding = listEnterpriseKnowledgeProjectionBindings({
      store,
      tenantId: "tenant-acme",
    }).find((item) => item.visibilityPolicyId);
    expect(binding).toBeTruthy();
    const bySeat = evaluateProjectionVisibility({
      store,
      tenantId: "tenant-acme",
      projectionId: binding!.projectionId,
      visibilityPolicyId: binding!.visibilityPolicyId,
      context: {
        tenantId: "tenant-acme",
        seatId: "seat-sales-director",
        userId: "u1",
        hasEnterpriseScope: true,
      },
    });
    expect(bySeat.visible).toBe(true);
    const byTeam = evaluateProjectionVisibility({
      store,
      tenantId: "tenant-acme",
      projectionId: binding!.projectionId,
      visibilityPolicyId: binding!.visibilityPolicyId,
      context: {
        tenantId: "tenant-acme",
        seatId: "seat-unknown",
        userId: "u1",
        teamLabel: "华东销售",
        hasEnterpriseScope: true,
      },
    });
    expect(byTeam.visible).toBe(true);
  });

  it("evaluates projection visibility by department and role", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId: "tenant-acme", nowIso: new Date().toISOString() });
    const binding = listEnterpriseKnowledgeProjectionBindings({
      store,
      tenantId: "tenant-acme",
    }).find((item) => item.visibilityPolicyId);
    expect(binding).toBeTruthy();
    const byRole = evaluateProjectionVisibility({
      store,
      tenantId: "tenant-acme",
      projectionId: binding!.projectionId,
      visibilityPolicyId: binding!.visibilityPolicyId,
      context: {
        tenantId: "tenant-acme",
        seatId: "seat-unknown",
        userId: "u1",
        roleCode: "sales-mgr",
        hasEnterpriseScope: true,
      },
    });
    expect(byRole.visible).toBe(true);
    const byDepartment = evaluateProjectionVisibility({
      store,
      tenantId: "tenant-acme",
      projectionId: binding!.projectionId,
      visibilityPolicyId: binding!.visibilityPolicyId,
      context: {
        tenantId: "tenant-acme",
        seatId: "seat-unknown",
        userId: "u1",
        departmentId: "sales-mgr:华东销售",
        hasEnterpriseScope: true,
      },
    });
    expect(byDepartment.visible).toBe(true);
  });
});
