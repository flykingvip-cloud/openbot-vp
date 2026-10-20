import { describe, expect, it } from "vitest";
import { scanText } from "../capability/employee-capability/terminology-filter.ts";
import type { CapabilityHealthLabel } from "../capability/employee-capability/types.ts";
import { healthRepairSuggestion } from "../views/capability-health-badge.ts";
import { projectHealthStatusToLabel, type RuntimeHealthStatus } from "./capability-health-label.ts";

const statuses: RuntimeHealthStatus[] = ["healthy", "warning", "broken"];
const expected: Record<RuntimeHealthStatus, CapabilityHealthLabel> = {
  healthy: "运行稳定",
  warning: "偶尔异常",
  broken: "需要重新整理",
};

describe("capability health label properties", () => {
  it("projects every runtime health status to employee language", () => {
    // Feature: skill-lifecycle-asset-system, Property 2: 健康标签投影完备
    for (let index = 0; index < 100; index += 1) {
      const status = statuses[index % statuses.length];
      expect(projectHealthStatusToLabel(status)).toBe(expected[status]);
    }
  });

  it("does not expose telemetry numbers or raw failure fields in suggestions", () => {
    // Feature: skill-lifecycle-asset-system, Property 16: 健康遥测投影为员工语言
    const labels: CapabilityHealthLabel[] = ["运行稳定", "偶尔异常", "需要重新整理"];
    for (let index = 0; index < 100; index += 1) {
      const suggestion = healthRepairSuggestion(labels[index % labels.length]) ?? "";
      expect(suggestion).not.toMatch(/\d+ms|successRate|latency|failureReasons|stack/i);
    }
  });

  it("keeps repair suggestions terminology-compliant", () => {
    // Feature: skill-lifecycle-asset-system, Property 22: 健康修复建议语言合规
    for (let index = 0; index < 100; index += 1) {
      const label = index % 2 === 0 ? "偶尔异常" : "需要重新整理";
      const suggestion = healthRepairSuggestion(label);
      expect(suggestion).toBeTruthy();
      expect(() => scanText(suggestion ?? "")).not.toThrow();
    }
  });
});
