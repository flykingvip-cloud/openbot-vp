// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadEnterpriseKnowledgeFeed } from "../knowledge/feed/enterprise-feed-adapter.js";
import { grantDataCapabilityToSeat } from "../knowledge/seat-capability-access.js";
import { resolveCapabilitySupplyFreshness } from "./capability-supply-freshness.js";
import { upsertDataConnectorCredential } from "./connector-credential-store.js";
import { saveCredentialSecret } from "./connector-credential-vault.js";
import { CONNECTOR_DEFAULT_PRODUCT_ACTOR } from "./connector-default-product-marker.js";
import { listConnectorDefaultProducts } from "./connector-default-products.js";
import { ensureConnectorPackage } from "./connector-packages.js";
import { buildDataAssetLinkage } from "./data-asset-linkage.js";
import { upsertDataCapability } from "./data-capability-store.js";
import { upsertDataSource } from "./data-source-store.js";
import { supplyDefaultDataProducts } from "./default-data-product-supply.js";
import {
  listEnterpriseKnowledgeProjectionBindings,
  upsertEnterpriseKnowledgeProjectionBinding,
} from "./enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { normalizeEnterpriseDataStore } from "./store.js";

const vaultDir = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-default-product-supply-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: vaultDir.tmpDir,
  };
});

const tenantId = "tenant-001";
const nowIso = "2026-11-08T13:00:00.000Z";
const sourceId = "src-licheng";

async function connectedYonyouSource() {
  fs.rmSync(vaultDir.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(vaultDir.tmpDir, { recursive: true });
  const store = normalizeEnterpriseDataStore({});
  ensureConnectorPackage({
    store,
    tenantId,
    connectorId: "erp-yonyou-tplus",
    nowIso,
  });
  const credential = upsertDataConnectorCredential({
    store,
    tenantId,
    connectorId: "erp-yonyou-tplus",
    label: "利成和信",
    kind: "oauth2",
    nowIso,
  });
  await saveCredentialSecret(credential.credentialId, {
    oauthAccessToken: "simulated-yonyou-tplus-token-abc",
  });
  upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId,
      sourceKey: "yonyou-tplus-licheng",
      displayName: "001-用友T+",
      category: "erp",
      status: "connected",
      connectorId: "erp-yonyou-tplus",
      credentialId: credential.credentialId,
    },
  });
  return store;
}

describe("default data product supply", () => {
  it("declares yonyou frontline products and ignores connectors without a pack", () => {
    const products = listConnectorDefaultProducts("erp-yonyou-tplus");
    expect(products.map((product) => product.productKey)).toEqual([
      "warehouse",
      "inventory",
      "partner",
      "current_stock",
      "purchase_receive",
      "sale_delivery",
      "sale_order",
    ]);
    expect(listConnectorDefaultProducts("crm-salesforce")).toEqual([]);
  });

  it("materializes pack products on supply without a manual materialize call", async () => {
    const store = await connectedYonyouSource();
    const first = await supplyDefaultDataProducts({
      store,
      tenantId,
      sourceId,
      nowIso,
      actionKeys: ["erp.purchase_receive.query_list", "erp.warehouse.query"],
    });
    expect(first.failed).toBe(0);
    expect(first.materialized).toBe(2);
    expect(first.capabilityIds).toHaveLength(2);

    const feeds = listKnowledgeFeedItems({ store, tenantId });
    expect(feeds).toHaveLength(2);
    const warehouse = feeds.find((item) => item.title.includes("仓库"));
    expect(warehouse?.payload).toMatchObject({ count: 1 });
    const purchase = feeds.find((item) => item.title.includes("采购入库"));
    expect(purchase).toBeTruthy();

    const bindings = listEnterpriseKnowledgeProjectionBindings({ store, tenantId, enabled: true });
    expect(bindings.every((binding) => binding.materializationMode === "scheduled")).toBe(true);

    const linkage = buildDataAssetLinkage({
      store,
      tenantId,
      callerUserId: null,
      nowIso,
      sourceId,
    })[0];
    expect(linkage?.products.map((product) => product.displayName).toSorted()).toEqual([
      "001-用友T+ · 仓库",
      "001-用友T+ · 采购入库",
    ]);
    expect(linkage?.verification.capabilities).toEqual([]);

    for (const capabilityId of first.capabilityIds) {
      expect(resolveCapabilitySupplyFreshness({ store, tenantId, capabilityId })).toBe("fresh");
    }

    const second = await supplyDefaultDataProducts({
      store,
      tenantId,
      sourceId,
      nowIso,
      actionKeys: ["erp.purchase_receive.query_list", "erp.warehouse.query"],
    });
    expect(second.materialized).toBe(0);
    expect(second.ensured).toBe(0);
    expect(listKnowledgeFeedItems({ store, tenantId })).toHaveLength(2);
  });

  it("promotes an existing manual binding and does not re-enable a disabled one", async () => {
    const store = await connectedYonyouSource();
    const capability = upsertDataCapability({
      store,
      tenantId,
      nowIso,
      capability: {
        capabilityKey: "001-purchase",
        displayName: "001-用友T+采购入库",
        description: "手工产品",
        sourceIds: [sourceId],
        actionRefs: [
          {
            connectorId: "erp-yonyou-tplus",
            actionKey: "erp.purchase_receive.query_list",
            version: "v1",
          },
        ],
        enabled: true,
      },
    });
    const spec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "001-purchase-projection",
        displayName: "001-用友T+采购入库投影",
        category: "inventory",
        capabilityId: capability.capabilityId,
        sourceId,
        sourceActions: [
          {
            connectorId: "erp-yonyou-tplus",
            actionKey: "erp.purchase_receive.query_list",
            version: "v1",
          },
        ],
        objectKind: "data",
        templateKey: "AggregateTemplate",
        description: "手工投影",
        outputSchema: { type: "object" },
        lifecycle: "active",
      },
    });
    const manual = upsertEnterpriseKnowledgeProjectionBinding({
      store,
      tenantId,
      nowIso,
      binding: {
        projectionId: spec.projectionId,
        capabilityId: capability.capabilityId,
        materializationMode: "on_demand",
        materializationTeamLabel: "default",
        enabled: true,
        generatorVersion: "v1",
      },
    });

    const supplied = await supplyDefaultDataProducts({
      store,
      tenantId,
      sourceId,
      nowIso,
      actionKeys: ["erp.purchase_receive.query_list"],
    });
    expect(supplied.materialized).toBe(1);
    expect(supplied.capabilityIds).toEqual([capability.capabilityId]);
    expect(store.enterpriseKnowledgeProjectionBindings[manual.bindingId]?.materializationMode).toBe(
      "scheduled",
    );
    expect(listKnowledgeFeedItems({ store, tenantId })).toHaveLength(1);

    const disabledSpec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "001-warehouse-off",
        displayName: "001-用友T+仓库",
        category: "inventory",
        capabilityId: upsertDataCapability({
          store,
          tenantId,
          nowIso,
          capability: {
            capabilityKey: "001-warehouse",
            displayName: "001-用友T+仓库",
            description: "停用",
            sourceIds: [sourceId],
            actionRefs: [
              {
                connectorId: "erp-yonyou-tplus",
                actionKey: "erp.warehouse.query",
                version: "v1",
              },
            ],
            enabled: true,
          },
        }).capabilityId,
        sourceId,
        sourceActions: [
          {
            connectorId: "erp-yonyou-tplus",
            actionKey: "erp.warehouse.query",
            version: "v1",
          },
        ],
        objectKind: "data",
        templateKey: "AggregateTemplate",
        description: "停用绑定",
        outputSchema: { type: "object" },
        lifecycle: "active",
      },
    });
    upsertEnterpriseKnowledgeProjectionBinding({
      store,
      tenantId,
      nowIso,
      binding: {
        projectionId: disabledSpec.projectionId,
        capabilityId: disabledSpec.capabilityId,
        materializationMode: "on_demand",
        materializationTeamLabel: "default",
        enabled: false,
        generatorVersion: "v1",
      },
    });
    const blocked = await supplyDefaultDataProducts({
      store,
      tenantId,
      sourceId,
      nowIso,
      actionKeys: ["erp.warehouse.query"],
    });
    expect(blocked.materialized).toBe(0);
    expect(
      listEnterpriseKnowledgeProjectionBindings({
        store,
        tenantId,
        projectionId: disabledSpec.projectionId,
      })[0]?.enabled,
    ).toBe(false);
    expect(listKnowledgeFeedItems({ store, tenantId })).toHaveLength(1);
  });

  it("hides pack-generated feed rows until the seat is authorized", async () => {
    const store = await connectedYonyouSource();
    const supplied = await supplyDefaultDataProducts({
      store,
      tenantId,
      sourceId,
      nowIso,
      actionKeys: ["erp.current_stock.query"],
    });
    const capabilityId = supplied.capabilityIds[0];
    expect(capabilityId).toBeTruthy();
    const spec = Object.values(store.enterpriseKnowledgeProjectionSpecs).find(
      (item) => item.capabilityId === capabilityId,
    );
    expect(spec?.createdBy).toBe(CONNECTOR_DEFAULT_PRODUCT_ACTOR);

    const context = {
      tenantId,
      seatId: "seat-frontline",
      userId: "user-1",
      hasEnterpriseScope: true,
    };
    const before = loadEnterpriseKnowledgeFeed({ store, context });
    expect(before.accessible).toHaveLength(0);
    expect(before.restricted.length).toBeGreaterThan(0);

    grantDataCapabilityToSeat({
      store,
      tenantId,
      seatId: "seat-frontline",
      capabilityId: capabilityId,
      nowIso,
    });
    const after = loadEnterpriseKnowledgeFeed({ store, context });
    expect(after.accessible.map((item) => item.title).join(" ")).toContain("现存量");
    expect(after.restricted).toHaveLength(0);
  });
});
