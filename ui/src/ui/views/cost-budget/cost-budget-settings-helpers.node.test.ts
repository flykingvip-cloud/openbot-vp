import { describe, expect, it } from "vitest";
import {
  canAccessCostBudgetSettings,
  computeAorTotal,
  isAnalyticsPanelVisible,
} from "./cost-budget-settings-helpers.ts";

describe("cost-budget-settings-helpers", () => {
  it("shows analytics panel only when aorTotal > 0", () => {
    expect(isAnalyticsPanelVisible(null)).toBe(false);
    expect(
      isAnalyticsPanelVisible({
        byKey: { aor_task: 0 },
        recordCount: 0,
        totalQuantity: 0,
        byUser: {},
        startTime: "",
        endTime: "",
      }),
    ).toBe(false);
    expect(
      isAnalyticsPanelVisible({
        byKey: { aor_task: 3 },
        recordCount: 1,
        totalQuantity: 3,
        byUser: {},
        startTime: "",
        endTime: "",
      }),
    ).toBe(true);
    expect(
      computeAorTotal({
        byKey: { aor_task: 2, aor_orchestration: 1 },
        recordCount: 2,
        totalQuantity: 3,
        byUser: {},
        startTime: "",
        endTime: "",
      }),
    ).toBe(3);
  });

  it("restricts settings to enterprise-admin", () => {
    expect(canAccessCostBudgetSettings("enterprise-admin")).toBe(true);
    expect(canAccessCostBudgetSettings(null)).toBe(true);
    expect(canAccessCostBudgetSettings(undefined)).toBe(true);
    expect(canAccessCostBudgetSettings("member")).toBe(false);
  });
});
