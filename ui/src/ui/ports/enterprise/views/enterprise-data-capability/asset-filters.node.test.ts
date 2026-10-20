import { describe, expect, it } from "vitest";
import {
  createDefaultAssetFilters,
  filterAssetSources,
  uniqueAssetCategories,
} from "./asset-filters.ts";

describe("asset-filters", () => {
  const sources = [
    {
      displayName: "CRM 生产",
      sourceKey: "crm-prod",
      category: "crm",
      status: "connected",
      connectorId: "salesforce",
    },
    {
      displayName: "ERP 备用",
      sourceKey: "erp-bak",
      category: "erp",
      status: "error",
      connectorId: "sap",
    },
  ];

  it("filters by query, status and category", () => {
    expect(
      filterAssetSources(sources, { ...createDefaultAssetFilters(), query: "crm" }),
    ).toHaveLength(1);
    expect(
      filterAssetSources(sources, { ...createDefaultAssetFilters(), status: "error" }),
    ).toEqual([sources[1]]);
    expect(
      filterAssetSources(sources, { ...createDefaultAssetFilters(), category: "erp" }),
    ).toEqual([sources[1]]);
  });

  it("lists unique categories", () => {
    expect(uniqueAssetCategories(sources)).toEqual(["crm", "erp"]);
  });
});
