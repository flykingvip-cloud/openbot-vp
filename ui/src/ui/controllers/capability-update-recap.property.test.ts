import { describe, expect, it } from "vitest";
import { scanText } from "../capability/employee-capability/terminology-filter.ts";
import type { CapabilityUpdateRecap } from "../capability/employee-capability/types.ts";
import { isEmployeeLanguageUpdateRecap } from "./capability-update-recap.ts";

function recap(index: number): CapabilityUpdateRecap {
  return {
    id: `recap-${index}`,
    at: 1_700_000_000_000 + index,
    headline:
      index % 2 === 0
        ? `最近更新 · 优化了使用场景说明 ${index}`
        : `最近更新 · 新增了常见任务示例 ${index}`,
  };
}

describe("capability update recap properties", () => {
  it("keeps update recap headlines employee-language only", () => {
    // Feature: skill-lifecycle-asset-system, Property 12: 更新回顾替代版本
    for (let index = 0; index < 100; index += 1) {
      const item = recap(index);
      expect(isEmployeeLanguageUpdateRecap(item)).toBe(true);
      expect(item.headline).not.toMatch(/v?\d+\.\d+\.\d+/);
      expect(() => scanText(item.headline)).not.toThrow();
    }
  });

  it("rejects version-like or technical update text", () => {
    // Feature: skill-lifecycle-asset-system, Property 12: 更新回顾替代版本
    const forbidden = ["version", "rollback", "migration", "v1.2.3"];
    for (const term of forbidden) {
      expect(
        isEmployeeLanguageUpdateRecap({
          id: term,
          at: 1,
          headline: `最近更新 · ${term}`,
        }),
      ).toBe(false);
    }
  });
});
