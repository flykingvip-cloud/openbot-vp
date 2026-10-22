import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScopeEvaluationResult } from "../types.js";
import {
  executeYonyouTplusHandler,
  probeYonyouTplusConnection,
  YONYOU_TPLUS_HANDLERS,
} from "./yonyou-tplus.js";

const ALL_SCOPE: ScopeEvaluationResult = {
  scopeType: "ALL",
  resolvedValues: {},
  appliedFilters: [],
  scopeAppliedLabel: "ALL",
};

const LIVE_SECRET = {
  appKey: "ak-test",
  appSecret: "as-test",
  oauthAccessToken: "open-token-1",
  orgId: "90001198862",
  sid: "6",
};

function readJsonBody(init: RequestInit): unknown {
  if (typeof init.body !== "string") {
    throw new Error("expected a string request body");
  }
  return JSON.parse(init.body);
}

describe("yonyou tplus adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does not call the network for a simulated token", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("fetch should not be called");
    });
    vi.stubGlobal("fetch", fetchMock);
    const probe = await probeYonyouTplusConnection({
      oauthAccessToken: "simulated-yonyou-tplus-token-abc",
    });
    expect(probe.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    const warehouse = await executeYonyouTplusHandler(
      YONYOU_TPLUS_HANDLERS.warehouse,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-1" },
      { oauthAccessToken: "simulated-yonyou-tplus-token-abc" },
    );
    const payload = warehouse.payload as { records: Array<{ Code: string }> };
    expect(payload.records[0]?.Code).toBe("01");
  });

  it("fails closed when appKey, appSecret, or openToken is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const probe = await probeYonyouTplusConnection({ orgId: "90001198862" });
    expect(probe.ok).toBe(false);
    expect(probe.message).toContain("openToken");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("probes accountAPI/GetVersionInfo with Chanjet headers", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ result: "16.000.000.0001" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const probe = await probeYonyouTplusConnection(LIVE_SECRET);
    expect(probe.ok).toBe(true);
    expect(probe.message).toContain("版本");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openapi.chanjet.com/tplus/api/v2/accountAPI/GetVersionInfo");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.headers).toMatchObject({
      appKey: "ak-test",
      appSecret: "as-test",
      openToken: "open-token-1",
      "Content-Type": "application/json",
      Cookie: "sid=6",
    });
  });

  it("reports the Chanjet error code when the probe is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: "401", message: "openToken无效" }, { status: 200 })),
    );
    const probe = await probeYonyouTplusConnection(LIVE_SECRET);
    expect(probe.ok).toBe(false);
    expect(probe.message).toContain("openToken无效");
  });

  it("reads warehouses with the documented empty param query", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([{ Code: "01", Name: "温州仓" }], { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeYonyouTplusHandler(
      YONYOU_TPLUS_HANDLERS.warehouse,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-1" },
      LIVE_SECRET,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openapi.chanjet.com/tplus/api/v2/warehouse/Query");
    expect(readJsonBody(init)).toEqual({ param: {} });
    const payload = result.payload as { records: Array<{ Code: string }> };
    expect(payload.records[0]?.Code).toBe("01");
  });

  it("leaves idMarketingOrgan off the URL unless the caller opts into the path query", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([{ Code: "01", Name: "温州仓" }], { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await executeYonyouTplusHandler(
      YONYOU_TPLUS_HANDLERS.warehouse,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-1" },
      { ...LIVE_SECRET, idMarketingOrgan: "1001" },
    );
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openapi.chanjet.com/tplus/api/v2/warehouse/Query");
  });

  it("appends idMarketingOrgan when the caller opts into the documented path query", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([{ Code: "01", Name: "温州仓" }], { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await executeYonyouTplusHandler(
      YONYOU_TPLUS_HANDLERS.warehouse,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-1" },
      { ...LIVE_SECRET, idMarketingOrgan: "1001" },
      { marketingOrganQuery: true },
    );
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://openapi.chanjet.com/tplus/api/v2/warehouse/Query?idMarketingOrgan=1001",
    );
  });

  it("reads the first page of sale orders with the documented list body", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { code: "0", message: "ok", data: { TotalCount: 0, Rows: [] } },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await executeYonyouTplusHandler(
      YONYOU_TPLUS_HANDLERS.saleOrder,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-1" },
      LIVE_SECRET,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openapi.chanjet.com/tplus/api/v2/SaleOrderOpenApi/FindVoucherList");
    expect(readJsonBody(init)).toEqual({
      pageSize: 20,
      pageIndex: 0,
      selectFields: ["SaleOrder.ID", "SaleOrder.VoucherDate", "SaleOrder.Code"],
      paramDic: {},
    });
  });

  it("reads the first page of sale deliveries with the documented list body", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { code: "0", message: "ok", data: { TotalCount: 0, Rows: [] } },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await executeYonyouTplusHandler(
      YONYOU_TPLUS_HANDLERS.saleDelivery,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-1" },
      LIVE_SECRET,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://openapi.chanjet.com/tplus/api/v2/SaleDeliveryOpenApi/FindVoucherList",
    );
    expect(readJsonBody(init)).toEqual({
      pageSize: 20,
      pageIndex: 0,
      selectFields: ["SaleDelivery.ID", "SaleDelivery.VoucherDate", "SaleDelivery.Code"],
      paramDic: {},
    });
  });

  it("uses the platform app credentials when the vault only stores the open token", async () => {
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY", "env-key");
    vi.stubEnv("OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_SECRET", "env-secret");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const probe = await probeYonyouTplusConnection({ oauthAccessToken: "open-token-from-oauth" });
    expect(probe.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      appKey: "env-key",
      appSecret: "env-secret",
      openToken: "open-token-from-oauth",
    });
  });
});
