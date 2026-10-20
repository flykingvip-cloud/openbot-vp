// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import {
  ensureOnDemandProjectionsMaterialized,
  type OnDemandProjectionContext,
} from "./on-demand-projection-materializer.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("ensureOnDemandProjectionsMaterialized", () => {
  it("creates feed records for visible on_demand bindings when feed is empty", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const onDemandBinding = listEnterpriseKnowledgeProjectionBindings({
      store,
      tenantId,
      enabled: true,
    }).find((binding) => binding.materializationMode === "on_demand");
    expect(onDemandBinding).toBeTruthy();

    const feedBefore = listKnowledgeFeedItems({ store, tenantId }).filter(
      (item) => item.projectionId === onDemandBinding!.projectionId,
    );
    expect(feedBefore).toHaveLength(0);

    const mutated = await ensureOnDemandProjectionsMaterialized({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-director",
        userId: "employee-1",
        agentType: "employee-agent",
        hasEnterpriseScope: true,
        teamLabel: "华东销售",
        roleCode: "sales-mgr",
      } as OnDemandProjectionContext,
      nowIso,
    });

    expect(mutated).toBe(true);
    const feedAfter = listKnowledgeFeedItems({ store, tenantId }).filter(
      (item) => item.projectionId === onDemandBinding!.projectionId,
    );
    expect(feedAfter.length).toBe(1);
  });

  it("skips when seat lacks enterprise visibility", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });

    const mutated = await ensureOnDemandProjectionsMaterialized({
      store,
      context: {
        tenantId,
        seatId: "seat-outsider",
        userId: "employee-9",
        hasEnterpriseScope: true,
      } as OnDemandProjectionContext,
      nowIso,
    });

    expect(mutated).toBe(false);
  });
});
