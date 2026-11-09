import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  YONYOU_TPLUS_DEFAULT_PAGE_SIZE,
  YONYOU_TPLUS_INVENTORY_SELECT_FIELDS,
  YONYOU_TPLUS_PARTNER_SELECT_FIELDS,
} from "./adapters/yonyou-tplus.js";
import { saveCredentialSecret } from "./connector-credential-vault.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { DataSource, EnterpriseDataStore } from "./types.js";
import {
  applyYonyouTplusSyncCursorToInput,
  listConnectorSyncLogEntries,
  syncYonyouTplusSource,
  yonyouTplusCatalogWatermark,
} from "./yonyou-tplus-sync.js";

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-yonyou-tplus-sync-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

const tenantId = "tenant-jingshanzi";
const sourceId = "src-yonyou";
const credentialId = "cred-yonyou";

function cleanStore() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

function sourceRecord(): DataSource {
  return {
    sourceId,
    tenantId,
    sourceKey: "yonyou-tplus",
    displayName: "用友 T+",
    category: "erp",
    status: "disconnected",
    connectorId: "erp-yonyou-tplus",
    credentialId,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function storeWithSource(): EnterpriseDataStore {
  const store = normalizeEnterpriseDataStore({});
  store.dataSources[sourceId] = sourceRecord();
  return store;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function jsonBody(init: RequestInit | undefined): Record<string, unknown> {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("expected a string request body");
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function pageIndexToken(param: Record<string, unknown>): string {
  const value = param.PageIndex;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function inventoryPage(count: number, totalPage = 1, currentPage = 1) {
  return {
    TotalCount: count,
    TotalPage: totalPage,
    CurrentPage: currentPage,
    Data: Array.from({ length: count }, (_, index) => ({
      Code: `SKU-${index}`,
      Name: "扇子",
    })),
  };
}

/** Official warehouse Query example returns a row array. No UpdateDate field exists on that contract. */
const WAREHOUSE_ROWS = [
  { Code: "02", Name: "面料仓", Ts: "0000000000000002" },
  { Code: "01", Name: "温州仓", Ts: "0000000000000001" },
];

function rememberWarehouse(
  url: string,
  body: Record<string, unknown>,
  bodies?: Array<Record<string, unknown>>,
): Response | undefined {
  if (!url.endsWith("/warehouse/Query")) {
    return undefined;
  }
  bodies?.push(body);
  return Response.json(WAREHOUSE_ROWS);
}

describe("yonyou tplus incremental sync", () => {
  beforeEach(async () => {
    cleanStore();
    vi.unstubAllGlobals();
    await saveCredentialSecret(credentialId, {
      appKey: "ak-test",
      appSecret: "as-test",
      oauthAccessToken: "open-token-1",
      idMarketingOrgan: "1001",
    });
  });

  it("pulls one inventory page and advances the watermark for the next run", async () => {
    const inventoryBodies: Array<Record<string, unknown>> = [];
    const deliveryBodies: Array<Record<string, unknown>> = [];
    const warehouseBodies: Array<Record<string, unknown>> = [];
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        urls.push(url);
        const body = jsonBody(init);
        if (url.endsWith("/accountAPI/GetVersionInfo")) {
          return Response.json({ result: "16.0" });
        }
        if (url.endsWith("/inventory/QueryPage")) {
          inventoryBodies.push(body);
          return Response.json(inventoryPage(1));
        }
        const warehouse = rememberWarehouse(url, body, warehouseBodies);
        if (warehouse) {
          return warehouse;
        }
        if (url.endsWith("/SaleDeliveryOpenApi/FindVoucherList")) {
          deliveryBodies.push(body);
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "1", TotalPageNum: "1", Rows: [["1", "2026/10/20", "SA-1"]] },
          });
        }
        if (url.endsWith("/partner/QueryPage")) {
          return Response.json({ TotalCount: 0, TotalPage: 1, CurrentPage: 1, Data: [] });
        }
        if (url.endsWith("/SaleOrderOpenApi/FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/PurchaseReceiveOpenApi/FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/currentStock/Query")) {
          return Response.json([]);
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    const store = storeWithSource();
    const firstNow = new Date("2026-10-22T06:00:00.000Z");
    const first = await syncYonyouTplusSource({
      store,
      tenantId,
      sourceId,
      now: firstNow,
    });
    expect(first.status).toBe("success");
    expect(store.dataSources[sourceId]?.lastSucceededAt).toBe(firstNow.toISOString());
    expect(store.dataSources[sourceId]?.lastMaterializedAt).toBeUndefined();
    expect(store.dataSources[sourceId]?.status).toBe("connected");
    expect(inventoryBodies[0]?.param).toEqual({
      PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
      PageIndex: "1",
      SelectFields: YONYOU_TPLUS_INVENTORY_SELECT_FIELDS,
    });
    expect(inventoryBodies[0]?.param).not.toHaveProperty("UpdateDateBegin");
    expect(inventoryBodies[0]?.param).not.toHaveProperty("UpdateDateEnd");
    expect(urls.some((url) => url.includes("idMarketingOrgan"))).toBe(false);
    expect(warehouseBodies[0]).toEqual({ param: { SelectFields: "ID,Code,Name,Ts" } });
    expect(urls.find((url) => url.includes("/warehouse/Query"))).toBe(
      "https://openapi.chanjet.com/tplus/api/v2/warehouse/Query",
    );
    const catalog = yonyouTplusCatalogWatermark(WAREHOUSE_ROWS);
    expect(store.connectorSyncCursors?.[`${sourceId}::warehouse`]?.watermark).toBe(catalog);
    expect(first.streams.find((stream) => stream.streamKey === "warehouse")).toMatchObject({
      status: "success",
      recordCount: 2,
      advanced: true,
      watermark: catalog,
    });
    expect(deliveryBodies[0]).toMatchObject({
      pageSize: YONYOU_TPLUS_DEFAULT_PAGE_SIZE,
      pageIndex: 0,
      paramDic: {
        "SaleDelivery.VoucherDate": [
          { text: "2026-10-15", value: "2026-10-15" },
          { text: "2026-10-22", value: "2026-10-22" },
        ],
      },
    });
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]?.watermark).toBe(
      "2026-10-22 06:00:00",
    );
    const delivery = urls.find((url) => url.includes("FindVoucherList"));
    expect(delivery).toBe(
      "https://openapi.chanjet.com/tplus/api/v2/SaleDeliveryOpenApi/FindVoucherList",
    );

    const secondNow = new Date("2026-10-22T08:30:00.000Z");
    const second = await syncYonyouTplusSource({
      store,
      tenantId,
      sourceId,
      now: secondNow,
    });
    expect(second.status).toBe("success");
    expect(inventoryBodies[1]?.param).toEqual({
      PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
      PageIndex: "1",
      SelectFields: YONYOU_TPLUS_INVENTORY_SELECT_FIELDS,
      UpdateDateBegin: "2026-10-22 06:00:00",
      UpdateDateEnd: "2026-10-22 08:30:00",
    });
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]?.watermark).toBe(
      "2026-10-22 08:30:00",
    );
    expect(second.streams.find((stream) => stream.streamKey === "warehouse")).toMatchObject({
      status: "success",
      advanced: false,
      watermark: catalog,
    });
    const logs = listConnectorSyncLogEntries({ store, tenantId, sourceId });
    expect(
      logs.some((entry) => entry.streamKey === "inventory" && entry.status === "success"),
    ).toBe(true);
    expect(
      logs.some(
        (entry) =>
          entry.streamKey === "warehouse" &&
          entry.status === "success" &&
          entry.detail.includes("目录未变化"),
      ),
    ).toBe(true);
  });

  it("logs a stream failure and does not advance that watermark", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith("/accountAPI/GetVersionInfo")) {
          return Response.json({ result: "16.0" });
        }
        if (url.endsWith("/inventory/QueryPage")) {
          return Response.json({ code: "500", message: "存货查询失败" });
        }
        if (url.endsWith("/warehouse/Query")) {
          return Response.json(WAREHOUSE_ROWS);
        }
        if (url.endsWith("/partner/QueryPage")) {
          return Response.json({ TotalCount: 0, TotalPage: 1, CurrentPage: 1, Data: [] });
        }
        if (url.includes("FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/PurchaseReceiveOpenApi/FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/currentStock/Query")) {
          return Response.json([]);
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const store = storeWithSource();
    const now = new Date("2026-10-22T06:00:00.000Z");
    const result = await syncYonyouTplusSource({ store, tenantId, sourceId, now });
    expect(result.status).toBe("warning");
    expect(result.streams.find((stream) => stream.streamKey === "inventory")).toMatchObject({
      status: "failure",
      advanced: false,
    });
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]).toBeUndefined();
    expect(store.connectorSyncCursors?.[`${sourceId}::partner`]?.watermark).toBe(
      "2026-10-22 06:00:00",
    );
    const logs = listConnectorSyncLogEntries({ store, tenantId, sourceId });
    const inventoryLog = logs.find((entry) => entry.streamKey === "inventory");
    expect(inventoryLog?.status).toBe("failure");
    expect(inventoryLog?.detail).toContain("存货查询失败");
    expect(store.dataSources[sourceId]?.lastSucceededAt).toBe(now.toISOString());
    expect(store.dataSources[sourceId]?.materializationCount).toBeUndefined();
  });

  it("keeps the watermark when an incremental window hits the range page cap", async () => {
    const inventoryIndexes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.endsWith("/accountAPI/GetVersionInfo")) {
          return Response.json({ result: "16.0" });
        }
        if (url.endsWith("/inventory/QueryPage")) {
          const body = jsonBody(init);
          const param = (body.param ?? {}) as Record<string, unknown>;
          inventoryIndexes.push(pageIndexToken(param));
          // Full pages (PAGE_SIZE) so pageIsComplete stays false until MaxPages truncates.
          return Response.json(
            inventoryPage(YONYOU_TPLUS_DEFAULT_PAGE_SIZE, 9, Number(pageIndexToken(param) || "1")),
          );
        }
        if (url.endsWith("/warehouse/Query")) {
          return Response.json(WAREHOUSE_ROWS);
        }
        if (url.endsWith("/partner/QueryPage")) {
          return Response.json({ TotalCount: 0, TotalPage: 1, CurrentPage: 1, Data: [] });
        }
        if (url.includes("FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/PurchaseReceiveOpenApi/FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/currentStock/Query")) {
          return Response.json([]);
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const store = storeWithSource();
    // Seed a watermark so this run uses the incremental UpdateDate window
    // (range page cap), not the first/full master budget.
    store.connectorSyncCursors ??= {};
    store.connectorSyncCursors[`${sourceId}::inventory`] = {
      cursorId: `${sourceId}::inventory`,
      tenantId,
      sourceId,
      streamKey: "inventory",
      watermark: "2026-10-21 00:00:00",
      updatedAt: "2026-10-21T00:00:00.000Z",
    };
    const result = await syncYonyouTplusSource({
      store,
      tenantId,
      sourceId,
      now: new Date("2026-10-22T06:00:00.000Z"),
    });
    expect(result.status).toBe("warning");
    const inventory = result.streams.find((stream) => stream.streamKey === "inventory");
    expect(inventory?.status).toBe("warning");
    expect(inventory?.recordCount).toBe(YONYOU_TPLUS_DEFAULT_PAGE_SIZE * 5);
    expect(inventory?.advanced).toBe(false);
    expect(inventoryIndexes).toEqual(["1", "2", "3", "4", "5"]);
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]?.watermark).toBe(
      "2026-10-21 00:00:00",
    );
    expect(store.connectorSyncSnapshots?.[`${sourceId}::inventory`]).toBeUndefined();
    const logs = listConnectorSyncLogEntries({ store, tenantId, sourceId });
    expect(logs.find((entry) => entry.streamKey === "inventory")?.status).toBe("warning");
    expect(logs.find((entry) => entry.streamKey === "inventory")?.detail).toContain("未拉完");
  });

  it("does not advance the warehouse fingerprint when the catalog pull fails or exceeds the cap", async () => {
    const previous = "catalog:previous";
    const store = storeWithSource();
    store.connectorSyncCursors ??= {};
    store.connectorSyncCursors[`${sourceId}::warehouse`] = {
      cursorId: `${sourceId}::warehouse`,
      tenantId,
      sourceId,
      streamKey: "warehouse",
      watermark: previous,
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith("/accountAPI/GetVersionInfo")) {
          return Response.json({ result: "16.0" });
        }
        if (url.endsWith("/warehouse/Query")) {
          return Response.json({ code: "500", message: "仓库查询失败" });
        }
        if (url.endsWith("/inventory/QueryPage") || url.endsWith("/partner/QueryPage")) {
          return Response.json({ TotalCount: 0, TotalPage: 1, CurrentPage: 1, Data: [] });
        }
        if (url.includes("FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/PurchaseReceiveOpenApi/FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/currentStock/Query")) {
          return Response.json([]);
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const failed = await syncYonyouTplusSource({
      store,
      tenantId,
      sourceId,
      now: new Date("2026-10-22T06:00:00.000Z"),
    });
    expect(failed.status).toBe("warning");
    expect(failed.streams.find((stream) => stream.streamKey === "warehouse")).toMatchObject({
      status: "failure",
      advanced: false,
      pulled: false,
    });
    expect(store.connectorSyncCursors?.[`${sourceId}::warehouse`]?.watermark).toBe(previous);
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]?.watermark).toBe(
      "2026-10-22 06:00:00",
    );
    const failureLog = listConnectorSyncLogEntries({ store, tenantId, sourceId }).find(
      (entry) => entry.streamKey === "warehouse",
    );
    expect(failureLog?.status).toBe("failure");
    expect(failureLog?.detail).toContain("仓库查询失败");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith("/accountAPI/GetVersionInfo")) {
          return Response.json({ result: "16.0" });
        }
        if (url.endsWith("/warehouse/Query")) {
          return Response.json(
            Array.from({ length: 501 }, (_, index) => ({
              Code: `W-${index}`,
              Name: "仓",
              Ts: "1",
            })),
          );
        }
        if (url.endsWith("/inventory/QueryPage") || url.endsWith("/partner/QueryPage")) {
          return Response.json({ TotalCount: 0, TotalPage: 1, CurrentPage: 1, Data: [] });
        }
        if (url.includes("FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/PurchaseReceiveOpenApi/FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/currentStock/Query")) {
          return Response.json([]);
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const capped = await syncYonyouTplusSource({
      store,
      tenantId,
      sourceId,
      now: new Date("2026-10-22T07:00:00.000Z"),
    });
    expect(capped.streams.find((stream) => stream.streamKey === "warehouse")).toMatchObject({
      status: "warning",
      recordCount: 501,
      advanced: false,
      pulled: true,
    });
    expect(store.connectorSyncCursors?.[`${sourceId}::warehouse`]?.watermark).toBe(previous);
    const warningLog = listConnectorSyncLogEntries({ store, tenantId, sourceId }).find(
      (entry) => entry.streamKey === "warehouse" && entry.status === "warning",
    );
    expect(warningLog?.detail).toContain("500");
  });
});

describe("yonyou tplus projection cursor window", () => {
  const now = new Date("2026-10-22T06:00:00.000Z");

  function writeCursor(store: EnterpriseDataStore, streamKey: string, watermark: string) {
    const id = `${sourceId}::${streamKey}`;
    store.connectorSyncCursors ??= {};
    store.connectorSyncCursors[id] = {
      cursorId: id,
      tenantId,
      sourceId,
      streamKey,
      watermark,
      updatedAt: "2026-10-21T00:00:00.000Z",
    };
  }

  it("fills the four date streams from the stored cursor and keeps an explicit window", () => {
    const store = storeWithSource();
    writeCursor(store, "inventory", "2026-10-20 00:00:00");
    writeCursor(store, "partner", "2026-10-19 08:00:00");
    writeCursor(store, "sale_delivery", "2026-10-18");
    writeCursor(store, "sale_order", "2026-10-17");
    writeCursor(store, "warehouse", "catalog:abc");

    const inventory = applyYonyouTplusSyncCursorToInput({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.inventory.query_page",
      now,
    });
    expect(inventory).toEqual({
      param: {
        PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
        PageIndex: "1",
        SelectFields: YONYOU_TPLUS_INVENTORY_SELECT_FIELDS,
        UpdateDateBegin: "2026-10-20 00:00:00",
        UpdateDateEnd: "2026-10-22 06:00:00",
      },
    });

    const partner = applyYonyouTplusSyncCursorToInput({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.partner.query_page",
      input: { param: { SelectFields: "Code" } },
      now,
    });
    expect(partner).toEqual({
      param: {
        SelectFields: "Code",
        PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
        PageIndex: "1",
        UpdateDateBegin: "2026-10-19 08:00:00",
        UpdateDateEnd: "2026-10-22 06:00:00",
      },
    });

    const delivery = applyYonyouTplusSyncCursorToInput({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.sale_delivery.query_list",
      now,
    });
    expect(delivery).toMatchObject({
      pageSize: YONYOU_TPLUS_DEFAULT_PAGE_SIZE,
      pageIndex: 0,
      paramDic: {
        "SaleDelivery.VoucherDate": [
          { text: "2026-10-18", value: "2026-10-18" },
          { text: "2026-10-22", value: "2026-10-22" },
        ],
      },
    });

    const order = applyYonyouTplusSyncCursorToInput({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.sale_order.query_list",
      now,
    });
    expect(order).toMatchObject({
      paramDic: {
        "SaleOrder.VoucherDate": [
          { text: "2026-10-17", value: "2026-10-17" },
          { text: "2026-10-22", value: "2026-10-22" },
        ],
      },
    });

    const explicit = applyYonyouTplusSyncCursorToInput({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.inventory.query_page",
      input: {
        param: {
          UpdateDateBegin: "2026-01-01 00:00:00",
          UpdateDateEnd: "2026-01-02 00:00:00",
        },
      },
      now,
    });
    expect(explicit).toEqual({
      param: {
        UpdateDateBegin: "2026-01-01 00:00:00",
        UpdateDateEnd: "2026-01-02 00:00:00",
      },
    });

    const warehouse = applyYonyouTplusSyncCursorToInput({
      store,
      tenantId,
      sourceId,
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.warehouse.query",
      input: { param: { Code: "01" } },
      now,
    });
    expect(warehouse).toEqual({ param: { Code: "01" } });

    const other = applyYonyouTplusSyncCursorToInput({
      store,
      tenantId,
      sourceId,
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      input: { customerId: "c-1" },
      now,
    });
    expect(other).toEqual({ customerId: "c-1" });

    const firstWindow = applyYonyouTplusSyncCursorToInput({
      store,
      tenantId,
      connectorId: "erp-yonyou-tplus",
      actionKey: "erp.inventory.query_page",
      now,
    });
    expect(firstWindow).toEqual({
      param: {
        PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
        PageIndex: "1",
        SelectFields: YONYOU_TPLUS_INVENTORY_SELECT_FIELDS,
      },
    });
  });
});

describe("yonyou tplus master first-sync full window", () => {
  beforeEach(async () => {
    cleanStore();
    vi.unstubAllGlobals();
    await saveCredentialSecret(credentialId, {
      appKey: "ak-test",
      appSecret: "as-test",
      oauthAccessToken: "open-token-1",
      idMarketingOrgan: "1001",
    });
  });

  it("first inventory/partner sync omits the 7-day UpdateDate window so empty archives are not marked complete", async () => {
    const inventoryBodies: Array<Record<string, unknown>> = [];
    const partnerBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        const body = jsonBody(init);
        if (url.endsWith("/accountAPI/GetVersionInfo")) {
          return Response.json({ result: "16.0" });
        }
        if (url.endsWith("/inventory/QueryPage")) {
          inventoryBodies.push(body);
          const param = (body.param ?? {}) as Record<string, unknown>;
          // Simulate Chanjet: archives with no recent UpdateDate are invisible
          // under a LOOKBACK window, but present on a full QueryPage.
          if ("UpdateDateBegin" in param || "UpdateDateEnd" in param) {
            return Response.json({ TotalCount: 0, TotalPage: 1, CurrentPage: 1, Data: [] });
          }
          return Response.json(inventoryPage(1));
        }
        if (url.endsWith("/partner/QueryPage")) {
          partnerBodies.push(body);
          const param = (body.param ?? {}) as Record<string, unknown>;
          if ("UpdateDateBegin" in param || "UpdateDateEnd" in param) {
            return Response.json({ TotalCount: 0, TotalPage: 1, CurrentPage: 1, Data: [] });
          }
          return Response.json({
            TotalCount: 1,
            TotalPage: 1,
            CurrentPage: 1,
            Data: [{ Code: "C001", Name: "客户甲" }],
          });
        }
        if (url.endsWith("/warehouse/Query")) {
          return Response.json(WAREHOUSE_ROWS);
        }
        if (
          url.endsWith("/SaleDeliveryOpenApi/FindVoucherList") ||
          url.endsWith("/SaleOrderOpenApi/FindVoucherList")
        ) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/PurchaseReceiveOpenApi/FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/currentStock/Query")) {
          return Response.json([]);
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    const store = storeWithSource();
    const now = new Date("2026-10-22T06:00:00.000Z");
    const result = await syncYonyouTplusSource({
      store,
      tenantId,
      sourceId,
      now,
    });
    expect(result.status).toBe("success");
    expect(inventoryBodies[0]?.param).toEqual({
      PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
      PageIndex: "1",
      SelectFields: YONYOU_TPLUS_INVENTORY_SELECT_FIELDS,
    });
    expect(partnerBodies[0]?.param).toEqual({
      PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
      PageIndex: "1",
      SelectFields: YONYOU_TPLUS_PARTNER_SELECT_FIELDS,
    });
    expect(inventoryBodies[0]?.param).not.toHaveProperty("UpdateDateBegin");
    expect(partnerBodies[0]?.param).not.toHaveProperty("UpdateDateBegin");
    expect(result.streams.find((stream) => stream.streamKey === "inventory")).toMatchObject({
      status: "success",
      recordCount: 1,
      advanced: true,
      detail: expect.stringContaining("首次全量"),
    });
    expect(result.streams.find((stream) => stream.streamKey === "partner")).toMatchObject({
      status: "success",
      recordCount: 1,
      advanced: true,
      detail: expect.stringContaining("首次全量"),
    });
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]?.watermark).toBe(
      "2026-10-22 06:00:00",
    );
    expect(store.connectorSyncCursors?.[`${sourceId}::partner`]?.watermark).toBe(
      "2026-10-22 06:00:00",
    );

    // Incremental follow-up keeps UpdateDate from the watermark.
    inventoryBodies.length = 0;
    partnerBodies.length = 0;
    const second = await syncYonyouTplusSource({
      store,
      tenantId,
      sourceId,
      now: new Date("2026-10-22T08:30:00.000Z"),
    });
    expect(second.status).toBe("success");
    expect(inventoryBodies[0]?.param).toEqual({
      PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
      PageIndex: "1",
      SelectFields: YONYOU_TPLUS_INVENTORY_SELECT_FIELDS,
      UpdateDateBegin: "2026-10-22 06:00:00",
      UpdateDateEnd: "2026-10-22 08:30:00",
    });
    expect(partnerBodies[0]?.param).toEqual({
      PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
      PageIndex: "1",
      SelectFields: YONYOU_TPLUS_PARTNER_SELECT_FIELDS,
      UpdateDateBegin: "2026-10-22 06:00:00",
      UpdateDateEnd: "2026-10-22 08:30:00",
    });
  });
});

describe("yonyou tplus master full sync page budget", () => {
  beforeEach(async () => {
    cleanStore();
    vi.unstubAllGlobals();
    delete process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MAX_PAGES_FULL;
    delete process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MAX_PAGES;
    await saveCredentialSecret(credentialId, {
      appKey: "ak-test",
      appSecret: "as-test",
      oauthAccessToken: "open-token-1",
      idMarketingOrgan: "1001",
    });
  });

  it("first/full inventory sync pages past the old 5×PAGE_SIZE range hard cap and advances the watermark", async () => {
    const inventoryIndexes: string[] = [];
    const totalPages = 7;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.endsWith("/accountAPI/GetVersionInfo")) {
          return Response.json({ result: "16.0" });
        }
        if (url.endsWith("/inventory/QueryPage")) {
          const body = jsonBody(init);
          const param = (body.param ?? {}) as Record<string, unknown>;
          expect(param).not.toHaveProperty("UpdateDateBegin");
          const pageIndex = Number(pageIndexToken(param) || "1");
          inventoryIndexes.push(String(pageIndex));
          const rows = pageIndex < totalPages ? YONYOU_TPLUS_DEFAULT_PAGE_SIZE : 5;
          return Response.json(inventoryPage(rows, totalPages, pageIndex));
        }
        if (url.endsWith("/partner/QueryPage")) {
          return Response.json({ TotalCount: 0, TotalPage: 1, CurrentPage: 1, Data: [] });
        }
        if (url.endsWith("/warehouse/Query")) {
          return Response.json(WAREHOUSE_ROWS);
        }
        if (
          url.endsWith("/SaleDeliveryOpenApi/FindVoucherList") ||
          url.endsWith("/SaleOrderOpenApi/FindVoucherList")
        ) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/PurchaseReceiveOpenApi/FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/currentStock/Query")) {
          return Response.json([]);
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    const store = storeWithSource();
    const now = new Date("2026-10-22T06:00:00.000Z");
    const result = await syncYonyouTplusSource({ store, tenantId, sourceId, now });
    expect(result.status).toBe("success");
    expect(inventoryIndexes).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(result.streams.find((stream) => stream.streamKey === "inventory")).toMatchObject({
      status: "success",
      recordCount: YONYOU_TPLUS_DEFAULT_PAGE_SIZE * 6 + 5,
      advanced: true,
      detail: expect.stringContaining("首次全量"),
    });
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]?.watermark).toBe(
      "2026-10-22 06:00:00",
    );
    expect(store.connectorSyncSnapshots?.[`${sourceId}::inventory`]?.recordCount).toBe(
      YONYOU_TPLUS_DEFAULT_PAGE_SIZE * 6 + 5,
    );
    expect(
      store.connectorSyncSnapshots?.[`${sourceId}::inventory`]?.recordCount ?? 0,
    ).toBeGreaterThan(YONYOU_TPLUS_DEFAULT_PAGE_SIZE);
  });

  it("honors OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MAX_PAGES_FULL when the full archive is still incomplete", async () => {
    process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MAX_PAGES_FULL = "3";
    const inventoryIndexes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.endsWith("/accountAPI/GetVersionInfo")) {
          return Response.json({ result: "16.0" });
        }
        if (url.endsWith("/inventory/QueryPage")) {
          const body = jsonBody(init);
          const param = (body.param ?? {}) as Record<string, unknown>;
          const pageIndex = Number(pageIndexToken(param) || "1");
          inventoryIndexes.push(String(pageIndex));
          return Response.json(inventoryPage(YONYOU_TPLUS_DEFAULT_PAGE_SIZE, 9, pageIndex));
        }
        if (url.endsWith("/partner/QueryPage")) {
          return Response.json({ TotalCount: 0, TotalPage: 1, CurrentPage: 1, Data: [] });
        }
        if (url.endsWith("/warehouse/Query")) {
          return Response.json(WAREHOUSE_ROWS);
        }
        if (
          url.endsWith("/SaleDeliveryOpenApi/FindVoucherList") ||
          url.endsWith("/SaleOrderOpenApi/FindVoucherList")
        ) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/PurchaseReceiveOpenApi/FindVoucherList")) {
          return Response.json({
            code: "0",
            message: "ok",
            data: { TotalCount: "0", TotalPageNum: "1", Rows: [] },
          });
        }
        if (url.endsWith("/currentStock/Query")) {
          return Response.json([]);
        }
        throw new Error(`unexpected ${url}`);
      }),
    );

    const store = storeWithSource();
    const result = await syncYonyouTplusSource({
      store,
      tenantId,
      sourceId,
      now: new Date("2026-10-22T06:00:00.000Z"),
    });
    expect(result.status).toBe("warning");
    expect(inventoryIndexes).toEqual(["1", "2", "3"]);
    expect(result.streams.find((stream) => stream.streamKey === "inventory")).toMatchObject({
      status: "warning",
      recordCount: YONYOU_TPLUS_DEFAULT_PAGE_SIZE * 3,
      advanced: false,
    });
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]).toBeUndefined();
  });
});
