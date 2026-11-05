// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  deleteKnowledgeFeedItem,
  findKnowledgeFeedItem,
  isCurrentSuppliedFeedItem,
  listKnowledgeFeedItems,
  upsertKnowledgeFeedItem,
} from "./knowledge-feed-item-store.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const tenantId = "tenant-feed-delete";
const nowIso = "2026-11-05T03:00:00.000Z";

function seedStore() {
  const store = normalizeEnterpriseDataStore(null);
  store.enterpriseKnowledgeProjectionSpecs["proj-1"] = {
    projectionId: "proj-1",
    tenantId,
    projectionKey: "warehouse",
    displayName: "仓库",
    category: "erp",
    sourceActions: [{ connectorId: "yonyou", actionKey: "erp.warehouse.query", version: "1" }],
    objectKind: "data",
    templateKey: "AggregateTemplate",
    description: "test",
    outputSchema: {},
    lifecycle: "active",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.enterpriseKnowledgeProjectionBindings["bind-1"] = {
    bindingId: "bind-1",
    tenantId,
    projectionId: "proj-1",
    materializationMode: "on_demand",
    materializationTeamLabel: "ops",
    enabled: true,
    generatorVersion: "test",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  return store;
}

function seedFeed(
  store: ReturnType<typeof seedStore>,
  objectId: string,
  generatedAt: string,
  title = "feed",
) {
  return upsertKnowledgeFeedItem({
    store,
    tenantId,
    nowIso: generatedAt,
    item: {
      objectId,
      projectionId: "proj-1",
      title,
      kind: "data",
      category: "erp",
      sourceSystems: ["yonyou"],
      scopeApplied: "tenant",
      maskedFields: [],
      generatedAt,
      traceRefs: ["trace-1"],
      payload: { count: 1 },
    },
  });
}

describe("knowledge-feed-item-store delete", () => {
  it("soft-deletes a superseded feed so list/find hide it", () => {
    const store = seedStore();
    seedFeed(store, "old-1", "2026-11-01T00:00:00.000Z", "模拟仓库");
    seedFeed(store, "new-1", "2026-11-05T00:00:00.000Z", "真数仓库");

    expect(isCurrentSuppliedFeedItem({ store, tenantId, objectId: "old-1" })).toBe(false);
    expect(isCurrentSuppliedFeedItem({ store, tenantId, objectId: "new-1" })).toBe(true);

    const deleted = deleteKnowledgeFeedItem({
      store,
      tenantId,
      objectId: "old-1",
      nowIso,
    });
    expect(deleted.deletedAt).toBe(nowIso);
    expect(listKnowledgeFeedItems({ store, tenantId }).map((item) => item.objectId)).toEqual([
      "new-1",
    ]);
    expect(findKnowledgeFeedItem(store, tenantId, "old-1")).toBeNull();
    expect(
      listKnowledgeFeedItems({ store, tenantId, includeDeleted: true }).map(
        (item) => item.objectId,
      ),
    ).toEqual(["new-1", "old-1"]);
  });

  it("refuses deleting the current supplied feed without force", () => {
    const store = seedStore();
    seedFeed(store, "cur-1", "2026-11-05T00:00:00.000Z", "当前供给");
    expect(() =>
      deleteKnowledgeFeedItem({
        store,
        tenantId,
        objectId: "cur-1",
        nowIso,
      }),
    ).toThrow(/force=true/);
    expect(findKnowledgeFeedItem(store, tenantId, "cur-1")).not.toBeNull();
  });

  it("allows force-deleting the current supplied feed", () => {
    const store = seedStore();
    seedFeed(store, "cur-1", "2026-11-05T00:00:00.000Z", "当前供给");
    const deleted = deleteKnowledgeFeedItem({
      store,
      tenantId,
      objectId: "cur-1",
      nowIso,
      force: true,
    });
    expect(deleted.deletedAt).toBe(nowIso);
    expect(listKnowledgeFeedItems({ store, tenantId })).toEqual([]);
  });

  it("allows deleting current feed when binding is disabled without force", () => {
    const store = seedStore();
    store.enterpriseKnowledgeProjectionBindings["bind-1"].enabled = false;
    seedFeed(store, "cur-1", "2026-11-05T00:00:00.000Z", "停用后");
    expect(isCurrentSuppliedFeedItem({ store, tenantId, objectId: "cur-1" })).toBe(false);
    deleteKnowledgeFeedItem({ store, tenantId, objectId: "cur-1", nowIso });
    expect(findKnowledgeFeedItem(store, tenantId, "cur-1")).toBeNull();
  });
});
