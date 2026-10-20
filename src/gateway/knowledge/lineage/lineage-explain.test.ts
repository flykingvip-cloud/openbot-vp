// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "../../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { runProjectionMaterialization } from "../../enterprise-data/projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../enterprise-data/store.js";
import { feedRecordObjectId } from "../feed/enterprise-feed-adapter.js";
import { explainKnowledgeLineage } from "./lineage-explain.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("knowledge lineage explain M6", () => {
  it("explains consumption-side lineage chain from store without gateway invoke", async () => {
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

    expect(explain.lineageId).toBeTruthy();
    expect(explain.chain.some((node) => node.layer === "feed_item")).toBe(true);
    expect(explain.chain.some((node) => node.layer === "projection")).toBe(true);
    expect(explain.chain.some((node) => node.layer === "connector_action")).toBe(true);
    const reverseRoles = explain.reverseChain.map((node) => node.role);
    expect(reverseRoles[0]).toBe("projection");
    expect(reverseRoles.indexOf("connector_action")).toBeLessThan(
      reverseRoles.indexOf("source_data"),
    );
    expect(explain.reverseChain.find((node) => node.role === "connector_action")?.id).toBe(
      "crm-salesforce::crm.customer.read_summary@v1",
    );
  });
});
