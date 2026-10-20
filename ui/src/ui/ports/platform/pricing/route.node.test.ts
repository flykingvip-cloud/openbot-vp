import { describe, expect, it } from "vitest";
import {
  platformPricingHomeHref,
  platformPricingHref,
  platformPricingPlanHref,
  platformPricingTierHref,
  resolvePricingRoute,
  resolvePricingView,
} from "./route.ts";

describe("platform pricing routes", () => {
  it("builds canonical home and plan hrefs", () => {
    expect(platformPricingHref("")).toBe("/platform/pricing");
    expect(platformPricingHomeHref("")).toBe("/platform/pricing");
    expect(platformPricingHomeHref("", { tab: "resourceCatalog" })).toBe(
      "/platform/pricing?tab=resourceCatalog",
    );
    expect(platformPricingPlanHref("", "plan-1")).toBe("/platform/pricing/plan-1");
    expect(platformPricingPlanHref("", "plan-1", "models")).toBe(
      "/platform/pricing/plan-1?mode=edit&tab=models",
    );
    expect(platformPricingPlanHref("", "plan-1", "bundle")).toBe(
      "/platform/pricing/plan-1?mode=edit&tab=bundle",
    );
    expect(platformPricingPlanHref("", "plan-1", "marketing")).toBe(
      "/platform/pricing/plan-1?mode=edit&tab=marketing",
    );
    expect(platformPricingTierHref("", "tier_b")).toBe("/platform/pricing/tiers/tier_b");
    expect(platformPricingTierHref("", "tier_b", "modelPool")).toBe(
      "/platform/pricing/tiers/tier_b#model-pool",
    );
  });

  it("resolves tier detail route", () => {
    const route = resolvePricingRoute("/platform/pricing/tiers/tier_b", "");
    expect(route.view).toBe("tierDetail");
    if (route.view === "tierDetail") {
      expect(route.tierId).toBe("tier_b");
    }
  });

  it("resolvePricingRoute maps home, detail, and create", () => {
    expect(resolvePricingRoute("/platform/pricing", "")).toEqual({ view: "home" });
    expect(resolvePricingRoute("/platform/pricing", "", "?mode=preview")).toEqual({
      view: "home",
    });
    expect(resolvePricingRoute("/platform/pricing", "", "?mode=edit")).toEqual({
      view: "home",
    });
    expect(resolvePricingRoute("/platform/pricing/plans", "")).toEqual({ view: "home" });
    expect(resolvePricingRoute("/platform/pricing/plan-1", "")).toEqual({
      view: "planDetail",
      planId: "plan-1",
      mode: "preview",
      editTab: "models",
    });
    expect(resolvePricingRoute("/platform/pricing/new", "")).toEqual({ view: "create" });
    expect(resolvePricingRoute("/app/platform/pricing/new", "/app")).toEqual({ view: "create" });
    expect(resolvePricingRoute("/app/platform/pricing", "/app")).toEqual({ view: "home" });
  });

  it("resolvePricingRoute accepts legacy /plans/:id paths", () => {
    expect(resolvePricingRoute("/platform/pricing/plans/plan-1", "")).toEqual({
      view: "planDetail",
      planId: "plan-1",
      mode: "preview",
      editTab: "models",
    });
  });

  it("resolvePricingView wraps resolvePricingRoute", () => {
    expect(resolvePricingView("/platform/pricing", "")).toBe("overview");
    expect(resolvePricingView("/platform/pricing/plans", "")).toBe("overview");
    expect(resolvePricingView("/platform/pricing/plan-1", "")).toBe("planDetail");
  });
});
