import { describe, expect, it } from "vitest";
import {
  guardCostBudgetV2Navigation,
  resolveGuardedCostBudgetV2Navigation,
} from "./cost-budget-v2-nav.ts";

describe("cost-budget-v2-nav access guard", () => {
  it("redirects non-admin settings deep links to overview", () => {
    const guarded = guardCostBudgetV2Navigation(
      {
        route: "settings",
        planOrdersPanel: "catalog",
        settingsPanel: "analytics",
      },
      "member",
    );
    expect(guarded.route).toBe("overview");
  });

  it("rebuilds canonical path after guard", () => {
    const resolved = resolveGuardedCostBudgetV2Navigation(
      "/enterprise/acme/usage/settings",
      "#analytics",
      "member",
    );
    expect(resolved.route).toBe("overview");
    expect(resolved.normalizedPath).toBe("/enterprise/acme/usage/overview");
    expect(resolved.normalizedHash).toBe("");
  });
});
