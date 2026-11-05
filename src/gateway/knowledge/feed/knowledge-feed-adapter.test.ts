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
});
