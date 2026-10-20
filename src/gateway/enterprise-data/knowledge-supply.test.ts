// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { resolveKnowledgeSupplyOverview } from "./knowledge-supply-store.js";
import { evaluateKnowledgeVisibility } from "./knowledge-visibility-policy-store.js";
import { runProjectionMaterialization } from "./projection-materializer.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("knowledge supply M4", () => {
  it("evaluates visibility by seat, team, and agent type (not agent instance id)", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const policy = Object.values(store.knowledgeVisibilityPolicies).find(
      (item) => item.tenantId === tenantId,
    );
    expect(policy).toBeTruthy();
    expect(
      evaluateKnowledgeVisibility({
        policy: policy!,
        context: { seatId: "seat-sales-director" },
      }),
    ).toBe(true);
    expect(
      evaluateKnowledgeVisibility({
        policy: policy!,
        context: { seatId: "seat-unknown", teamLabel: "华东销售" },
      }),
    ).toBe(true);
    expect(
      evaluateKnowledgeVisibility({
        policy: policy!,
        context: { seatId: "seat-unknown", agentType: "employee-agent" },
      }),
    ).toBe(true);
    expect(
      evaluateKnowledgeVisibility({
        policy: policy!,
        context: { seatId: "seat-unknown", agentType: "platform-agent" },
      }),
    ).toBe(false);
    expect(
      evaluateKnowledgeVisibility({
        policy: policy!,
        context: { seatId: "seat-unknown", agentType: undefined },
      }),
    ).toBe(false);
    expect(
      evaluateKnowledgeVisibility({
        policy: policy!,
        context: { seatId: "seat-unknown", roleCode: "sales-mgr" },
      }),
    ).toBe(true);
    expect(
      evaluateKnowledgeVisibility({
        policy: policy!,
        context: { seatId: "seat-unknown", departmentId: "sales-mgr:华东销售" },
      }),
    ).toBe(true);
  });

  it("returns supply overview with feed counts after materialization", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
      const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
      return spec?.projectionKey === "customer.profile";
    });
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding!.bindingId,
      nowIso,
    });
    const overview = resolveKnowledgeSupplyOverview({ store, tenantId, nowIso });
    expect(overview.feedItemCount).toBe(1);
    expect(overview.lineageRecordCount).toBe(1);
    expect(overview.visibilityPolicyCount).toBe(1);
    expect(overview.freshness.fresh).toBe(1);
    expect(overview.recentFeedItems).toHaveLength(1);
  });
});
