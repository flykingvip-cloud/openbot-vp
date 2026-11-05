// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listEnterpriseKnowledgeProjectionBindings } from "../../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { upsertKnowledgeFeedItem } from "../../enterprise-data/knowledge-feed-item-store.js";
import { runProjectionMaterialization } from "../../enterprise-data/projection-materializer.js";
import { seedEnterpriseDataCatalog } from "../../enterprise-data/seeds.js";
import { normalizeEnterpriseDataStore } from "../../enterprise-data/store.js";
import { adaptEnterpriseFeedRecord, feedPayloadExcerpt } from "./enterprise-feed-adapter.js";
import { loadKnowledgeFeedBundle } from "./knowledge-feed-adapter.js";

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";

describe("knowledge feed adapter M6", () => {
  it("does not publish projection specs that have no persisted feed item", () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const bundle = loadKnowledgeFeedBundle({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-director",
        userId: "employee-1",
        agentType: "employee-agent",
        hasEnterpriseScope: true,
      },
    });
    expect(bundle.feedItems.filter((item) => item.source === "enterprise")).toEqual([]);
    expect(bundle.feedItems.filter((item) => item.source === "data")).toEqual([]);
    expect(bundle.enterpriseAccessible).toEqual([]);
    expect(bundle.enterpriseRestricted).toEqual([]);
    expect(bundle.dataObjects).toEqual([]);
  });

  it("publishes materialized enterprise feed items with lineage and freshness", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
      const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
      return spec?.projectionKey === "customer.profile";
    });
    expect(binding).toBeTruthy();
    await runProjectionMaterialization({
      store,
      tenantId,
      bindingId: binding!.bindingId,
      nowIso,
    });

    const bundle = loadKnowledgeFeedBundle({
      store,
      context: {
        tenantId,
        seatId: "seat-sales-director",
        userId: "employee-1",
        agentType: "employee-agent",
        hasEnterpriseScope: true,
      },
    });

    expect(bundle.feedItems.length).toBeGreaterThan(0);
    const enterpriseFeed = bundle.feedItems.find((item) => item.source === "enterprise");
    expect(enterpriseFeed?.lineageId).toBeTruthy();
    expect(enterpriseFeed?.freshnessStatus).toBe("fresh");
    expect(bundle.enterpriseAccessible.length).toBeGreaterThan(0);
    expect(bundle.dataObjects).toEqual([]);
    expect(bundle.feedItems.every((item) => item.source === "enterprise")).toBe(true);
  });

  it("copies warehouse rows into accessible feed summaries and hides them when restricted", () => {
    const store = normalizeEnterpriseDataStore(null);
    const record = upsertKnowledgeFeedItem({
      store,
      tenantId,
      nowIso,
      item: {
        projectionId: "proj-warehouse",
        title: "001-用友T+仓库",
        kind: "data",
        category: "warehouse",
        sourceSystems: ["erp-yonyou-tplus"],
        scopeApplied: "team",
        maskedFields: [],
        generatedAt: nowIso,
        traceRefs: ["trace-1"],
        payload: {
          items: [{ Code: "WH01", Name: "京扇子仓" }],
          openToken: "should-not-leak",
        },
      },
    });
    const bundle = loadKnowledgeFeedBundle({
      store,
      context: {
        tenantId,
        seatId: "seat-ceo",
        userId: "employee-1",
        agentType: "employee-agent",
        hasEnterpriseScope: true,
      },
    });
    const accessible = bundle.enterpriseAccessible.find((item) => item.title === "001-用友T+仓库");
    expect(accessible?.summary).toContain("京扇子仓");
    expect(accessible?.summary).not.toContain("should-not-leak");

    const restricted = adaptEnterpriseFeedRecord({
      item: record,
      binding: null,
      accessState: "restricted",
    });
    expect(restricted.summary).not.toContain("京扇子仓");
    expect(restricted.summary).not.toContain("should-not-leak");
  });

  it("compacts partner AggregateTemplate excerpts so later Names survive past the budget", () => {
    const partnerNames = [
      "北京京扇子",
      "苏州扇来善往",
      "上海某某贸易",
      "杭州扇庄",
      "南京往来甲",
      "广州往来乙",
      "深圳往来丙",
      "成都往来丁",
      "武汉往来戊",
      "长沙往来己",
    ];
    const maskedNoise: Record<string, string> = {
      MobilePhone: "***",
      BankAccount: "***",
      Address: "***",
      Contact: "***",
      Email: "***",
      Fax: "***",
      SaleMan: "***",
      Department: "***",
      Disabled: "***",
      MadeDate: "***",
      ShortName: "***",
    };
    for (let i = 0; i < 30; i += 1) {
      maskedNoise[`UnknownField${String(i).padStart(2, "0")}`] = "***";
    }
    const items = partnerNames.map((Name, index) => ({
      Code: String(index + 1).padStart(4, "0"),
      Name,
      ID: index + 1,
      PartnerType: { Code: "01", Name: "客户" },
      ...maskedNoise,
    }));
    const payload = { count: items.length, items };
    const noisy = JSON.stringify(payload);
    expect(noisy.length).toBeGreaterThan(900);
    // Naive hard-cut keeps only the first partner Name; later plaintext Names are lost.
    expect(noisy.slice(0, 900)).not.toContain("苏州扇来善往");
    expect(noisy.slice(0, 900)).not.toContain("上海某某贸易");

    const excerpt = feedPayloadExcerpt(payload);
    expect(excerpt).toContain("苏州扇来善往");
    expect(excerpt).toContain("上海某某贸易");
    expect(excerpt).toContain("长沙往来己");
    expect(excerpt).not.toContain('"MobilePhone"');
    expect(excerpt).not.toContain('"***"');

    const record = upsertKnowledgeFeedItem({
      store: normalizeEnterpriseDataStore(null),
      tenantId,
      nowIso,
      item: {
        projectionId: "proj-partner",
        title: "001-用友T+往来单位",
        kind: "data",
        category: "partner",
        sourceSystems: ["erp-yonyou-tplus"],
        scopeApplied: "team",
        maskedFields: ["MobilePhone", "BankAccount"],
        generatedAt: nowIso,
        traceRefs: ["trace-partner"],
        payload,
      },
    });
    const adapted = adaptEnterpriseFeedRecord({
      item: record,
      binding: null,
      accessState: "accessible",
    });
    expect(adapted.summary).toContain("苏州扇来善往");
    expect(adapted.summary).toContain("上海某某贸易");
    expect(adapted.summary).not.toContain('"***"');
  });

  it("keeps nested T+ analytics fields when AggregateTemplate exceeds excerpt budget", () => {
    // Over-budget force-projects items[] via projectBusinessItemKeys. Pre-fix whitelist
    // dropped Customer / SaleDeliveryDetails / InvSCost (only id|code|name|…).
    const noise: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) {
      noise[`UnknownField${String(i).padStart(2, "0")}`] = "***";
    }
    const saleItems = Array.from({ length: 8 }, (_, index) => ({
      ID: index + 1,
      Code: `SA-2026-${String(index + 1).padStart(4, "0")}`,
      VoucherDate: "2026-11-01",
      Customer: { Code: `C${index + 1}`, Name: `客户${index + 1}` },
      Warehouse: { Code: "WH01", Name: "京扇子仓" },
      SaleDeliveryDetails: {
        Inventory: { Code: `SKU${index + 1}`, Name: `存货${index + 1}` },
        Quantity: 2 + index,
        OrigTaxPrice: "90.00",
        OrigTaxAmount: String(180 + index * 10),
      },
      ...noise,
    }));
    const salePayload = { count: saleItems.length, items: saleItems };
    expect(JSON.stringify(salePayload).length).toBeGreaterThan(1600);

    const saleExcerpt = feedPayloadExcerpt(salePayload);
    expect(saleExcerpt).toContain("客户1");
    expect(saleExcerpt).toContain("OrigTaxAmount");
    expect(saleExcerpt).toContain("Quantity");
    expect(saleExcerpt).toContain("存货1");
    expect(saleExcerpt).toContain('"Inventory"');
    expect(saleExcerpt).not.toContain('"***"');

    const inventoryItems = Array.from({ length: 10 }, (_, index) => ({
      ID: index + 1,
      Code: `INV${index + 1}`,
      Name: `风扇${index + 1}`,
      Specification: "规格A",
      InvSCost: String(10 + index),
      LatestCost: String(12 + index),
      AvagCost: String(11 + index),
      RetailPriceNew: "99.00",
      ...noise,
    }));
    const inventoryPayload = { count: inventoryItems.length, items: inventoryItems };
    expect(JSON.stringify(inventoryPayload).length).toBeGreaterThan(1600);
    const inventoryExcerpt = feedPayloadExcerpt(inventoryPayload);
    expect(inventoryExcerpt).toContain("InvSCost");
    expect(inventoryExcerpt).toContain("LatestCost");
    expect(inventoryExcerpt).toContain("风扇1");
    expect(inventoryExcerpt).not.toContain('"***"');

    const stockItems = Array.from({ length: 12 }, (_, index) => ({
      WarehouseCode: "WH01",
      WarehouseName: "京扇子仓",
      InventoryCode: `SKU${index + 1}`,
      InventoryName: `存货${index + 1}`,
      Specification: "规格",
      UnitName: "个",
      AvailableQuantity: String(100 + index),
      ExistingQuantity: String(120 + index),
      ...noise,
    }));
    const stockPayload = { count: stockItems.length, items: stockItems };
    expect(JSON.stringify(stockPayload).length).toBeGreaterThan(1600);
    const stockExcerpt = feedPayloadExcerpt(stockPayload);
    expect(stockExcerpt).toContain("AvailableQuantity");
    expect(stockExcerpt).toContain("ExistingQuantity");
    expect(stockExcerpt).toContain("京扇子仓");
    expect(stockExcerpt).toContain("存货1");
    expect(stockExcerpt).not.toContain('"***"');
  });

  it("flattens sale voucher details so ≥20 rows keep Customer/Quantity/OrigTaxAmount under budget", () => {
    // LIVE after #246: fat SaleDeliveryDetails JSON lets only ~2 of 242 rows keep经营键.
    // Compact flatten: Code|Date|Customer.Name|ΣQty|ΣOrigTaxAmount|首品名 — no full details.
    const noise: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) {
      noise[`UnknownField${String(i).padStart(2, "0")}`] = "***";
    }
    const saleItems = Array.from({ length: 24 }, (_, index) => ({
      ID: index + 1,
      Code: `SA-2026-${String(index + 1).padStart(4, "0")}`,
      VoucherDate: "2026-11-01",
      Customer: { Code: `C${index + 1}`, Name: `客户${index + 1}` },
      Warehouse: { Code: "WH01", Name: "京扇子仓" },
      // Multi-line details (array) — the fat shape that starved the 1600 budget.
      SaleDeliveryDetails: [
        {
          Inventory: { Code: `SKU${index + 1}A`, Name: `存货${index + 1}甲` },
          Quantity: 2 + index,
          OrigTaxPrice: "90.00",
          OrigTaxAmount: String(180 + index * 10),
        },
        {
          Inventory: { Code: `SKU${index + 1}B`, Name: `存货${index + 1}乙` },
          Quantity: 1,
          OrigTaxPrice: "50.00",
          OrigTaxAmount: "50.00",
        },
      ],
      ...noise,
    }));
    const salePayload = { count: saleItems.length, items: saleItems };
    expect(saleItems.length).toBeGreaterThanOrEqual(20);
    expect(JSON.stringify(salePayload).length).toBeGreaterThan(3200);

    const saleExcerpt = feedPayloadExcerpt(salePayload);
    expect(saleExcerpt).not.toContain("SaleDeliveryDetails");
    expect(saleExcerpt).not.toContain('"***"');

    const parsed = JSON.parse(saleExcerpt.replace(/…$/, "")) as {
      count?: number;
      items?: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(parsed.items)).toBe(true);
    const items = parsed.items ?? [];
    // With flatten + 3200 budget, most of the 20-preview rows keep经营键 — not just 1–2.
    expect(items.length).toBeGreaterThanOrEqual(20);

    const rich = items.filter((row) => {
      const customer = row.Customer as { Name?: string } | undefined;
      return (
        typeof customer?.Name === "string" &&
        customer.Name.length > 0 &&
        row.Quantity !== undefined &&
        row.OrigTaxAmount !== undefined
      );
    });
    expect(rich.length).toBeGreaterThanOrEqual(Math.ceil(items.length * 0.5));
    expect(rich.length).toBeGreaterThanOrEqual(20);
    expect(saleExcerpt).toContain("客户1");
    expect(saleExcerpt).toContain("客户20");
    expect(saleExcerpt).toContain("存货1甲");
    // ΣQuantity for row0 = (2+0)+1 = 3; ΣOrigTaxAmount = 180+50 = 230
    expect(items[0]?.Quantity).toBe(3);
    expect(items[0]?.OrigTaxAmount).toBe(230);
  });
});
