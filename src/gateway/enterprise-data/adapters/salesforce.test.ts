// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeSalesforceInstanceUrl, probeSalesforceConnection } from "./salesforce.js";

describe("salesforce adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes instance URL without scheme", () => {
    expect(normalizeSalesforceInstanceUrl("na1.salesforce.com")).toBe("https://na1.salesforce.com");
  });

  it("probes live connection when API returns 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const result = await probeSalesforceConnection({
      instanceUrl: "https://example.salesforce.com",
      apiKey: "token-1234",
    });
    expect(result.ok).toBe(true);
  });

  it("reports failure when API returns non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );
    const result = await probeSalesforceConnection({
      instanceUrl: "https://example.salesforce.com",
      apiKey: "bad-token",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("401");
  });
});
