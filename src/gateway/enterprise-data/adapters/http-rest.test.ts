// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScopeEvaluationResult } from "../types.js";
import {
  buildHttpRestRequest,
  executeHttpRestHandler,
  HTTP_REST_READ_HANDLER_REF,
  normalizeHttpRestBaseUrl,
  probeHttpRestConnection,
} from "./http-rest.js";

const ALL_SCOPE: ScopeEvaluationResult = {
  scopeType: "ALL",
  appliedFilters: [],
  resolvedValues: {},
  scopeAppliedLabel: "ALL",
};

describe("http-rest adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes base URL: adds scheme, strips trailing slash", () => {
    expect(normalizeHttpRestBaseUrl("api.example.com/")).toBe("https://api.example.com");
    expect(normalizeHttpRestBaseUrl("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1",
    );
  });

  it("throws when base URL is empty", () => {
    expect(() => normalizeHttpRestBaseUrl("   ")).toThrow();
  });

  it("probes live connection when API returns 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const result = await probeHttpRestConnection({
      instanceUrl: "https://api.example.com",
      apiKey: "token-1234",
    });
    expect(result.ok).toBe(true);
  });

  it("reports failure when API returns non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );
    const result = await probeHttpRestConnection({
      instanceUrl: "https://api.example.com",
      apiKey: "bad-token",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
  });

  it("reports failure when fetch throws a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const result = await probeHttpRestConnection({
      instanceUrl: "https://api.example.com",
      apiKey: "token-1234",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("reports failure (not throw) when no access token is provided", async () => {
    const result = await probeHttpRestConnection({ instanceUrl: "https://api.example.com" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("token");
  });

  it("reads a JSON resource via the read handler and joins the path", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [1, 2] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await executeHttpRestHandler(
      HTTP_REST_READ_HANDLER_REF,
      { input: { path: "/v1/items" }, scope: ALL_SCOPE, employeeId: "emp-1" },
      { instanceUrl: "https://api.example.com", apiKey: "token-1234" },
    );
    expect(result.payload).toEqual({ resource: { items: [1, 2] } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/items",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects unsupported handler refs", async () => {
    await expect(
      executeHttpRestHandler(
        "enterprise-data/handlers/unknown",
        { scope: ALL_SCOPE, employeeId: "emp-1" },
        { instanceUrl: "https://api.example.com", apiKey: "token-1234" },
      ),
    ).rejects.toThrow();
  });
});

describe("http-rest auth schemes", () => {
  it("defaults to a Bearer authorization header", () => {
    const { url, headers } = buildHttpRestRequest("https://api.example.com", {
      apiKey: "token-1234",
    });
    expect(url).toBe("https://api.example.com");
    expect(headers.Authorization).toBe("Bearer token-1234");
  });

  it("supports a custom auth header scheme", () => {
    const { headers } = buildHttpRestRequest("https://api.example.com", {
      apiKey: "token-1234",
      authScheme: "header",
      authHeaderName: "X-API-Key",
    });
    expect(headers["X-API-Key"]).toBe("token-1234");
    expect(headers.Authorization).toBeUndefined();
  });

  it("supports a query parameter scheme", () => {
    const { url } = buildHttpRestRequest("https://api.example.com/v1", {
      apiKey: "token-1234",
      authScheme: "query",
      authQueryParam: "api_key",
    });
    expect(url).toBe("https://api.example.com/v1?api_key=token-1234");
  });

  it("supports basic auth with a username", () => {
    const { headers } = buildHttpRestRequest("https://api.example.com", {
      apiKey: "pass",
      authScheme: "basic",
      basicUsername: "user",
    });
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  });

  it("allows no-auth without a token", () => {
    const { headers } = buildHttpRestRequest("https://api.example.com", { authScheme: "none" });
    expect(headers.Authorization).toBeUndefined();
  });

  it("throws when the header scheme is missing its header name", () => {
    expect(() =>
      buildHttpRestRequest("https://api.example.com", {
        apiKey: "token",
        authScheme: "header",
      }),
    ).toThrow();
  });

  it("probes the configured health path", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await probeHttpRestConnection({
      instanceUrl: "https://api.example.com",
      apiKey: "token-1234",
      probePath: "/health",
    });
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns ok:false (not throw) when a required header name is missing during probe", async () => {
    const result = await probeHttpRestConnection({
      instanceUrl: "https://api.example.com",
      apiKey: "token-1234",
      authScheme: "header",
    });
    expect(result.ok).toBe(false);
  });
});
