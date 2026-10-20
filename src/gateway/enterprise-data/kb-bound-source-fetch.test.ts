import { describe, expect, it } from "vitest";
import { parseEnterpriseDataSourceLocator } from "./kb-bound-source-fetch.js";

describe("parseEnterpriseDataSourceLocator", () => {
  it("parses tenant/source/connector from the UI bind endpoint", () => {
    expect(
      parseEnterpriseDataSourceLocator(
        "enterprise-data://tenant/acme%2Fcorp/source/src-xueqiu?connectorId=conn-1",
      ),
    ).toEqual({
      tenantId: "acme/corp",
      sourceId: "src-xueqiu",
      connectorId: "conn-1",
    });
  });

  it("returns null for non enterprise-data endpoints", () => {
    expect(parseEnterpriseDataSourceLocator("https://api.example.test/v1")).toBeNull();
    expect(parseEnterpriseDataSourceLocator("")).toBeNull();
    expect(parseEnterpriseDataSourceLocator(undefined)).toBeNull();
  });
});
