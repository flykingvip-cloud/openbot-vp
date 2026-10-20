import { describe, expect, it } from "vitest";
import {
  buildCostBudgetV2Hash,
  buildCostBudgetV2UsageHref,
  mapLegacySubRouteToV2,
  resolveCostBudgetV2Navigation,
  shouldNormalizeCostBudgetV2Url,
} from "./cost-budget-v2-routes.ts";

describe("cost-budget-v2-routes", () => {
  it("maps legacy commerce routes to plan-orders", () => {
    expect(mapLegacySubRouteToV2("orders")).toEqual({
      route: "plan-orders",
      planOrdersPanel: "orders",
      settingsPanel: "budget",
      legacySource: "orders",
    });
    expect(mapLegacySubRouteToV2("invoices")).toMatchObject({
      route: "plan-orders",
      planOrdersPanel: "orders",
    });
  });

  it("maps legacy settings routes to settings panels", () => {
    expect(mapLegacySubRouteToV2("control")).toMatchObject({
      route: "settings",
      settingsPanel: "budget",
    });
    expect(mapLegacySubRouteToV2("analytics")).toMatchObject({
      route: "settings",
      settingsPanel: "analytics",
    });
  });

  it("normalizes legacy pathname to canonical v2 route", () => {
    const resolved = resolveCostBudgetV2Navigation("/enterprise/acme/usage/orders", "");
    expect(resolved.route).toBe("plan-orders");
    expect(resolved.planOrdersPanel).toBe("orders");
    expect(resolved.normalizedPath).toBe("/enterprise/acme/usage/plan-orders");
    expect(resolved.normalizedHash).toBe("#orders");
    expect(shouldNormalizeCostBudgetV2Url("/enterprise/acme/usage/orders", "", resolved)).toBe(
      true,
    );
  });

  it("supports explicit /usage/v2 prefix", () => {
    const resolved = resolveCostBudgetV2Navigation(
      "/enterprise/acme/usage/v2/settings",
      "#resources",
    );
    expect(resolved.route).toBe("settings");
    expect(resolved.settingsPanel).toBe("resources");
    expect(resolved.normalizedPath).toBe("/enterprise/acme/usage/settings");
  });

  it("builds hash only for non-default panels", () => {
    expect(
      buildCostBudgetV2Hash({
        route: "plan-orders",
        planOrdersPanel: "catalog",
        settingsPanel: "budget",
      }),
    ).toBe("");
    expect(
      buildCostBudgetV2Hash({
        route: "plan-orders",
        planOrdersPanel: "orders",
        settingsPanel: "budget",
      }),
    ).toBe("#orders");
  });

  it("builds tenant usage href with settings hash", () => {
    expect(
      buildCostBudgetV2UsageHref("", "acme", {
        route: "settings",
        settingsPanel: "resources",
        hash: "#resources",
      }),
    ).toBe("/enterprise/acme/usage/settings#resources");
  });
});
