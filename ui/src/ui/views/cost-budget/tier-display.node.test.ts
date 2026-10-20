import { describe, expect, it } from "vitest";
import { formatTierDisplayName, formatTierList, formatTierListCompact } from "./tier-display.ts";

describe("tier-display", () => {
  it("maps known tier ids to friendly labels", () => {
    expect(formatTierDisplayName("tier_a")).toContain("Tier A");
    expect(formatTierDisplayName("tier_b")).toContain("Tier B");
    expect(formatTierList(["tier_a", "tier_b"])).toContain("、");
    expect(formatTierList(["tier_a", "tier_b"])).not.toContain("tier_a");
  });

  it("formats compact tier list for dense UI", () => {
    expect(formatTierListCompact(["tier_b", "tier_c"])).toBe("Tier B + Tier C");
    expect(formatTierListCompact(["tier_a"])).toBe("Tier A");
    expect(formatTierListCompact([])).toBe("—");
  });

  it("falls back to raw id for unknown tiers", () => {
    expect(formatTierDisplayName("custom_tier")).toBe("custom_tier");
  });
});
