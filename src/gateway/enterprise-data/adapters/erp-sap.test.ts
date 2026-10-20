// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeConnectorHandlerAsync } from "../connector-handler-runtime.js";
import type { ScopeEvaluationResult } from "../types.js";
import {
  executeErpSapHandler,
  normalizeErpSapInstanceUrl,
  probeErpSapConnection,
} from "./erp-sap.js";

const ALL_SCOPE: ScopeEvaluationResult = {
  scopeType: "ALL",
  resolvedValues: {},
  appliedFilters: [],
  scopeAppliedLabel: "ALL",
};

const READ_STATUS_HANDLER = "enterprise-data/handlers/erp-order-read-status-v1";

describe("erp-sap adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes instance URL without scheme", () => {
    expect(normalizeErpSapInstanceUrl("sap.example.com")).toBe("https://sap.example.com");
  });

  it("probes a simulated credential without a network call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch should not be called for simulated credentials");
      }),
    );
    const result = await probeErpSapConnection({
      instanceUrl: "https://sap.example.com",
      apiKey: "simulated-dev",
    });
    expect(result.ok).toBe(true);
  });

  it("probes live connection when the OData service returns 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const result = await probeErpSapConnection({
      instanceUrl: "https://sap.example.com",
      apiKey: "token-1234",
    });
    expect(result.ok).toBe(true);
  });

  it("reports failure when the OData service returns non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );
    const result = await probeErpSapConnection({
      instanceUrl: "https://sap.example.com",
      apiKey: "bad-token",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
  });

  it("returns deterministic simulated order status in dev mode", async () => {
    const result = await executeErpSapHandler(
      READ_STATUS_HANDLER,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-1" },
      { instanceUrl: "https://sap.example.com", apiKey: "simulated-dev" },
    );
    const payload = result.payload as { order: { id: string; status: string; created_by: string } };
    expect(payload.order.status).toBe("shipped");
    expect(payload.order.created_by).toBe("emp-1");
  });

  it("maps a live SAP OData v2 sales-order response to the order payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              d: { results: [{ SalesOrder: "SO-9001", OverallSDProcessStatus: "C" }] },
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await executeErpSapHandler(
      READ_STATUS_HANDLER,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-2" },
      { instanceUrl: "https://sap.example.com", apiKey: "token-1234" },
    );
    const payload = result.payload as { order: { id: string; status: string } };
    expect(payload.order.id).toBe("SO-9001");
    expect(payload.order.status).toBe("C");
  });

  it("throws on an unsupported handler", async () => {
    await expect(
      executeErpSapHandler(
        "enterprise-data/handlers/unknown",
        { input: {}, scope: ALL_SCOPE, employeeId: "emp-3" },
        { instanceUrl: "https://sap.example.com", apiKey: "token" },
      ),
    ).rejects.toThrow(/does not support handler/);
  });
});

describe("erp-sap connector-handler routing", () => {
  it("routes to the live SAP adapter when a credential secret is present", async () => {
    const result = await executeConnectorHandlerAsync(
      READ_STATUS_HANDLER,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-9" },
      {
        connectorId: "erp-sap",
        credentialSecret: { instanceUrl: "https://sap.example.com", apiKey: "simulated-route" },
      },
    );
    const payload = result.payload as { order: { id: string } };
    expect(payload.order.id).toBe("sap-sim-1001");
  });

  it("falls back to the mock handler when no credential secret is present", async () => {
    const result = await executeConnectorHandlerAsync(
      READ_STATUS_HANDLER,
      { input: {}, scope: ALL_SCOPE, employeeId: "emp-9" },
      { connectorId: "erp-sap", credentialSecret: null },
    );
    const payload = result.payload as { order: { id: string } };
    expect(payload.order.id).toBe("order-1001");
  });
});
