import { describe, expect, it } from "vitest";
import { parseMcpDiscoveryContext } from "./mcp-discovery-deeplink.ts";
import {
  dataSectionsForPrimary,
  legacySectionForPrimary,
  normalizeLegacySection,
  PRIMARY_TAB_NAV,
  resolveRouteFromLegacySection,
  resolveRouteFromLocation,
} from "./section-routing.ts";

describe("enterprise-data-capability section-routing", () => {
  it("exposes four primary tabs with business labels", () => {
    expect(PRIMARY_TAB_NAV.map((item) => item.id)).toEqual([
      "overview",
      "assets",
      "products",
      "governance",
    ]);
    expect(PRIMARY_TAB_NAV.map((item) => item.label)).toEqual([
      "总览",
      "数据资产",
      "数据产品",
      "权限与治理",
    ]);
  });

  it("maps legacy sections to primary tabs and sub-panels", () => {
    expect(resolveRouteFromLegacySection("home").primary).toBe("overview");
    expect(resolveRouteFromLegacySection("sources").primary).toBe("assets");
    expect(resolveRouteFromLegacySection("capabilities")).toMatchObject({
      primary: "products",
      productsSubPanel: "catalog",
    });
    expect(resolveRouteFromLegacySection("projections")).toMatchObject({
      primary: "products",
      productsSubPanel: "outputs",
    });
    expect(resolveRouteFromLegacySection("authorization")).toMatchObject({
      primary: "governance",
      governanceSubPanel: "matrix",
    });
    expect(resolveRouteFromLegacySection("approvals")).toMatchObject({
      primary: "governance",
      governanceSubPanel: "approvals",
    });
    expect(resolveRouteFromLegacySection("memory")).toMatchObject({
      primary: "governance",
      governanceSubPanel: "memory",
    });
  });

  it("normalizes hash/query aliases", () => {
    expect(normalizeLegacySection("#Approvals")).toBe("approvals");
    expect(normalizeLegacySection("products")).toBe("capabilities");
    expect(normalizeLegacySection("assets")).toBe("sources");
    expect(normalizeLegacySection("scope")).toBe("memory");
    expect(normalizeLegacySection("unknown")).toBeNull();
  });

  it("resolves location hash and edc query with overview fallback", () => {
    expect(resolveRouteFromLocation({ hash: "#projections" }).primary).toBe("products");
    expect(resolveRouteFromLocation({ hash: "", search: "?edc=approvals" })).toMatchObject({
      primary: "governance",
      governanceSubPanel: "approvals",
    });
    expect(resolveRouteFromLocation({ hash: "", search: "" }).primary).toBe("overview");
  });

  it("keeps edc routing when mcp discovery query params are present", () => {
    const routed = resolveRouteFromLocation({
      hash: "",
      search: "?edc=capabilities&mcpServer=linear&mcpTool=list_issues",
    });
    expect(routed).toMatchObject({
      primary: "products",
      legacySection: "capabilities",
    });
    expect(
      parseMcpDiscoveryContext("?edc=capabilities&mcpServer=linear&mcpTool=list_issues"),
    ).toEqual({
      mcpServer: "linear",
      mcpTool: "list_issues",
      capabilityId: null,
      requestId: null,
    });
  });

  it("round-trips primary tab back to legacy section for data loading", () => {
    expect(legacySectionForPrimary("overview")).toBe("home");
    expect(legacySectionForPrimary("assets")).toBe("sources");
    expect(legacySectionForPrimary("products", { productsSubPanel: "catalog" })).toBe(
      "capabilities",
    );
    expect(legacySectionForPrimary("products", { productsSubPanel: "outputs" })).toBe(
      "projections",
    );
    expect(legacySectionForPrimary("governance", { governanceSubPanel: "approvals" })).toBe(
      "approvals",
    );
    expect(legacySectionForPrimary("governance", { governanceSubPanel: "audit" })).toBe("audit");
    expect(dataSectionsForPrimary("products", { productsSubPanel: "catalog" })).toEqual([
      "capabilities",
    ]);
    expect(dataSectionsForPrimary("products", { productsSubPanel: "outputs" })).toEqual([
      "projections",
    ]);
    expect(dataSectionsForPrimary("governance", { governanceSubPanel: "matrix" })).toEqual([
      "authorization",
    ]);
    expect(dataSectionsForPrimary("governance", { governanceSubPanel: "approvals" })).toEqual([
      "approvals",
    ]);
    expect(dataSectionsForPrimary("governance", { governanceSubPanel: "audit" })).toEqual([
      "audit",
    ]);
  });
});
