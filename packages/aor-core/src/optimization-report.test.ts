import { describe, expect, it } from "vitest";
import {
  computeOptimizationReport,
  formatOptimizationReportMarkdown,
} from "./optimization-report.js";

describe("optimization report", () => {
  it("computes savings and revenue share", () => {
    const report = computeOptimizationReport({
      baseline: { policy: "strong", totalCostUsd: 1.0, avgCompletion: 1 },
      optimized: { policy: "aor", totalCostUsd: 0.6, avgCompletion: 1 },
    });
    expect(report.costSavingsUsd).toBeCloseTo(0.4);
    expect(report.costSavingsPct).toBeCloseTo(0.4);
    expect(report.revenueShareUsd).toBeCloseTo(0.08);
  });

  it("formats markdown", () => {
    const input = {
      baseline: { policy: "strong", totalCostUsd: 1, avgCompletion: 1 },
      optimized: { policy: "aor", totalCostUsd: 0.5, avgCompletion: 1 },
    };
    const report = computeOptimizationReport(input);
    const md = formatOptimizationReportMarkdown(input, report);
    expect(md).toContain("Cost savings");
    expect(md).toContain("Revenue share");
  });
});
