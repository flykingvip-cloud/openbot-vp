import { describe, expect, it } from "vitest";
import { evaluateMarginHealth, marginRateFromCents } from "./package-margin.js";

describe("marginRateFromCents", () => {
  it("正常计算毛利率", () => {
    expect(marginRateFromCents(10_000, 2_500)).toBeCloseTo(0.75);
  });
  it("MRR<=0 返回 null", () => {
    expect(marginRateFromCents(0, 100)).toBeNull();
    expect(marginRateFromCents(-1, 100)).toBeNull();
  });
});

describe("evaluateMarginHealth", () => {
  const thresholds = { targetMarginRate: 0.8, guardMarginRate: 0.65 };

  it("实际 >= 目标 → healthy", () => {
    expect(evaluateMarginHealth({ actualMarginRate: 0.82, ...thresholds }).health).toBe("healthy");
    expect(evaluateMarginHealth({ actualMarginRate: 0.8, ...thresholds }).health).toBe("healthy");
  });

  it("警戒 <= 实际 < 目标 → warning", () => {
    expect(evaluateMarginHealth({ actualMarginRate: 0.7, ...thresholds }).health).toBe("warning");
    expect(evaluateMarginHealth({ actualMarginRate: 0.65, ...thresholds }).health).toBe("warning");
  });

  it("实际 < 警戒 → critical（亏钱告警）", () => {
    expect(evaluateMarginHealth({ actualMarginRate: 0.5, ...thresholds }).health).toBe("critical");
  });

  it("无实际数据 → unknown", () => {
    expect(evaluateMarginHealth({ actualMarginRate: null, ...thresholds }).health).toBe("unknown");
    expect(evaluateMarginHealth({ actualMarginRate: undefined, ...thresholds }).health).toBe(
      "unknown",
    );
  });

  it("未配置阈值 → unknown（不告警）", () => {
    expect(evaluateMarginHealth({ actualMarginRate: 0.5 }).health).toBe("unknown");
  });

  it("仅配置警戒线时仍可判定", () => {
    expect(evaluateMarginHealth({ actualMarginRate: 0.5, guardMarginRate: 0.6 }).health).toBe(
      "critical",
    );
    expect(evaluateMarginHealth({ actualMarginRate: 0.7, guardMarginRate: 0.6 }).health).toBe(
      "healthy",
    );
  });
});
