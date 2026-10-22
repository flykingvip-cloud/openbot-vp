import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveCredentialSecret } from "./connector-credential-vault.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { DataSource, EnterpriseDataStore } from "./types.js";
import { listConnectorSyncLogEntries, syncYonyouTplusSource } from "./yonyou-tplus-sync.js";

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

function inventoryPage(count: number, totalPage = 1) {
  return {
    TotalCount: count,
    TotalPage: totalPage,
    CurrentPage: 1,
    Data: Array.from({ length: count }, (_, index) => ({
      Code: `SKU-${index}`,
      Name: "扇子",
    })),
  };
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
      PageSize: "20",
      PageIndex: "1",
      UpdateDateBegin: "2026-10-15 06:00:00",
      UpdateDateEnd: "2026-10-22 06:00:00",
    });
    expect(urls.some((url) => url.includes("idMarketingOrgan"))).toBe(false);
    expect(deliveryBodies[0]).toMatchObject({
      pageSize: 20,
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
      PageSize: "20",
      PageIndex: "1",
      UpdateDateBegin: "2026-10-22 06:00:00",
      UpdateDateEnd: "2026-10-22 08:30:00",
    });
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]?.watermark).toBe(
      "2026-10-22 08:30:00",
    );
    const logs = listConnectorSyncLogEntries({ store, tenantId, sourceId });
    expect(
      logs.some((entry) => entry.streamKey === "inventory" && entry.status === "success"),
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

  it("keeps the watermark when a page is full and the window is truncated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith("/accountAPI/GetVersionInfo")) {
          return Response.json({ result: "16.0" });
        }
        if (url.endsWith("/inventory/QueryPage")) {
          return Response.json(inventoryPage(20, 9));
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
    const inventory = result.streams.find((stream) => stream.streamKey === "inventory");
    expect(inventory?.status).toBe("warning");
    expect(inventory?.recordCount).toBe(100);
    expect(inventory?.advanced).toBe(false);
    expect(store.connectorSyncCursors?.[`${sourceId}::inventory`]).toBeUndefined();
    const logs = listConnectorSyncLogEntries({ store, tenantId, sourceId });
    expect(logs.find((entry) => entry.streamKey === "inventory")?.status).toBe("warning");
  });
});
