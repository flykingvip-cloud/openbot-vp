import { describe, expect, it } from "vitest";
import {
  MODEL_COST_FX_USD_TO_RMB,
  resolveModelCostDefault,
  usdPer1MToRmbCents,
} from "./model-cost-defaults.js";

describe("model-cost-defaults", () => {
  it("converts USD/1M to RMB cents with the FX constant", () => {
    expect(usdPer1MToRmbCents(3)).toBe(Math.round(3 * MODEL_COST_FX_USD_TO_RMB * 100));
    expect(usdPer1MToRmbCents(3)).toBe(2160);
    expect(usdPer1MToRmbCents(0)).toBe(0);
  });

  it("classifies flagship / standard / economy tiers", () => {
    expect(resolveModelCostDefault("anthropic/claude-opus-4-1")?.tier).toBe("tier_c");
    expect(resolveModelCostDefault("anthropic/claude-3-7-sonnet")?.tier).toBe("tier_b");
    expect(resolveModelCostDefault("anthropic/claude-3-5-haiku")?.tier).toBe("tier_a");
    expect(resolveModelCostDefault("deepseek/deepseek-chat")?.tier).toBe("tier_a");
  });

  it("matches lightweight variants before their standard family", () => {
    expect(resolveModelCostDefault("openai/gpt-4o-mini")?.tier).toBe("tier_a");
    expect(resolveModelCostDefault("openai/gpt-4o")?.tier).toBe("tier_b");
    expect(resolveModelCostDefault("openai/gpt-5-mini")?.tier).toBe("tier_a");
    expect(resolveModelCostDefault("openai/gpt-5")?.tier).toBe("tier_b");
    expect(resolveModelCostDefault("google/gemini-2.5-flash")?.tier).toBe("tier_a");
    expect(resolveModelCostDefault("google/gemini-2.5-pro")?.tier).toBe("tier_b");
  });

  it("does not misclassify gemini as a mini variant", () => {
    // "gemini" 字面包含 "mini"，但 mini 规则有 gpt5/o3/o4 前缀限定，不应误命中。
    expect(resolveModelCostDefault("google/gemini-2.5-pro")?.ruleId).toBe("gemini");
  });

  it("returns RMB-cent prices for a known model (sonnet $3/$15)", () => {
    const d = resolveModelCostDefault("anthropic/claude-3-7-sonnet");
    expect(d).not.toBeNull();
    expect(d?.inputCostPer1MCents).toBe(2160); // $3 × 7.2 × 100
    expect(d?.outputCostPer1MCents).toBe(10800); // $15 × 7.2 × 100
    expect(d?.ruleId).toBe("claude-sonnet");
  });

  it("returns null for unknown / empty models", () => {
    expect(resolveModelCostDefault("acme/mystery-model")).toBeNull();
    expect(resolveModelCostDefault("")).toBeNull();
  });
});
