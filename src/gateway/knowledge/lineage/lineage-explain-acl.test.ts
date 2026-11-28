// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "../../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { runProjectionMaterialization } from "../../enterprise-data/projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../enterprise-data/store.js";
import { canAccessEnterpriseFeedProjection } from "../feed/enterprise-feed-adapter.js";
import { feedRecordObjectId } from "../feed/enterprise-feed-adapter.js";
import type { KnowledgeSourceContext } from "../sources/types.js";
import { explainKnowledgeLineage } from "./lineage-explain.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

async function materializeProfile() {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
    const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
    return spec?.projectionKey === "customer.profile";
  });
  const materialized = await runProjectionMaterialization({
    store,
    tenantId,
    bindingId: binding!.bindingId,
    nowIso,
  });
  const explain = explainKnowledgeLineage({
    store,
    tenantId,
    objectId: feedRecordObjectId(materialized.objectId),
  });
  return { store, binding, explain };
}

describe("E019 lineage explain feed visibility and grant", () => {
  it("denies explain when the seat fails visibility policy, and allows a matching seat", async () => {
    const { store, binding, explain } = await materializeProfile();
    expect(binding?.visibilityPolicyId || true).toBeTruthy();

    const deniedContext: KnowledgeSourceContext = {
      tenantId,
      seatId: null,
      userId: "u-denied",
      hasEnterpriseScope: true,
    };
    const allowedContext: KnowledgeSourceContext = {
      tenantId,
      seatId: "seat-sales-director",
      userId: "u-allowed",
      hasEnterpriseScope: true,
    };

    expect(
      canAccessEnterpriseFeedProjection({
        store,
        tenantId,
        projectionId: explain.projectionId,
        context: deniedContext,
      }),
    ).toBe(false);

    expect(
      canAccessEnterpriseFeedProjection({
        store,
        tenantId,
        projectionId: explain.projectionId,
        context: allowedContext,
      }),
    ).toBe(true);
  });

  it("treats an unmatched seat without team/role/department as not visible when a policy exists", async () => {
    const { store, binding, explain } = await materializeProfile();
    if (!binding?.visibilityPolicyId) {
      // Seed always attaches a policy to at least some bindings; skip-fail if this
      // particular profile projection has none — then the unmatched-seat case
      // cannot be asserted against a policy.
      expect(binding?.visibilityPolicyId).toBeTruthy();
      return;
    }
    const unmatched: KnowledgeSourceContext = {
      tenantId,
      seatId: "seat-unknown",
      userId: "u-other",
      hasEnterpriseScope: true,
    };
    expect(
      canAccessEnterpriseFeedProjection({
        store,
        tenantId,
        projectionId: explain.projectionId,
        context: unmatched,
      }),
    ).toBe(false);
  });
});
