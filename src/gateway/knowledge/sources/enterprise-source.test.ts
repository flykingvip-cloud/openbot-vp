import { describe, expect, it } from "vitest";
import {
  listEnterpriseKnowledgeProjectionBindings,
  upsertEnterpriseKnowledgeProjectionBinding,
} from "../../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { runProjectionMaterialization } from "../../enterprise-data/projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../enterprise-data/store.js";
import { loadEnterpriseKnowledgeBrowse } from "./enterprise-source.js";

describe("enterprise knowledge browse", () => {
  it("surfaces restricted projections separately from accessible objects", async () => {
    const store = normalizeEnterpriseDataStore({});
    seedEnterpriseDataCatalog({
      store,
      tenantId: "tenant-acme",
      nowIso: new Date().toISOString(),
    });
    const specs = Object.values(store.enterpriseKnowledgeProjectionSpecs).filter(
      (item) => item.tenantId === "tenant-acme" && item.lifecycle === "active",
    );
    const target = specs[0];
    expect(target).toBeTruthy();
    store.knowledgeVisibilityPolicies["policy-hr-only"] = {
      policyId: "policy-hr-only",
      tenantId: "tenant-acme",
      projectionId: target.projectionId,
      visibleSeats: ["seat-hr-director"],
      visibleTeams: [],
      visibleDepartments: [],
      visibleRoles: [],
      visibleAgentTypes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const existingBinding = listEnterpriseKnowledgeProjectionBindings({
      store,
      tenantId: "tenant-acme",
      projectionId: target.projectionId,
    })[0];
    expect(existingBinding).toBeTruthy();
    upsertEnterpriseKnowledgeProjectionBinding({
      store,
      tenantId: "tenant-acme",
      nowIso: new Date().toISOString(),
      binding: {
        bindingId: existingBinding.bindingId,
        projectionId: target.projectionId,
        capabilityId: target.capabilityId,
        materializationMode: existingBinding.materializationMode,
        materializationTeamLabel: existingBinding.materializationTeamLabel,
        freshnessSlaMinutes: existingBinding.freshnessSlaMinutes,
        enabled: true,
        generatorVersion: existingBinding.generatorVersion,
        visibilityPolicyId: "policy-hr-only",
      },
    });

    await runProjectionMaterialization({
      store,
      tenantId: "tenant-acme",
      bindingId: existingBinding.bindingId,
      nowIso: new Date().toISOString(),
    });
    const browse = loadEnterpriseKnowledgeBrowse({
      store,
      context: {
        tenantId: "tenant-acme",
        seatId: "seat-sales-director",
        userId: "employee-1",
        hasEnterpriseScope: true,
      },
    });

    expect(browse.restricted.some((item) => item.projectionId === target.projectionId)).toBe(true);
    expect(browse.accessible.some((item) => item.projectionId === target.projectionId)).toBe(false);
    expect(browse.restricted[0]?.accessState).toBe("restricted");
  });
});
