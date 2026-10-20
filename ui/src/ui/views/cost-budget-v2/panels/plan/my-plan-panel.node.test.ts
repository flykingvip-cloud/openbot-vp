import { describe, expect, it } from "vitest";
import { defaultPlanOrdersPanelForSubscription } from "./my-plan-panel.ts";

describe("defaultPlanOrdersPanelForSubscription", () => {
  it("keeps catalog when subscribed (选购对比 / 更换套餐)", () => {
    expect(defaultPlanOrdersPanelForSubscription("catalog", true)).toBe("catalog");
  });

  it("redirects plan to catalog when unsubscribed", () => {
    expect(defaultPlanOrdersPanelForSubscription("plan", false)).toBe("catalog");
  });

  it("keeps orders panel regardless of subscription", () => {
    expect(defaultPlanOrdersPanelForSubscription("orders", true)).toBe("orders");
    expect(defaultPlanOrdersPanelForSubscription("orders", false)).toBe("orders");
  });
});
