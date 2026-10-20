// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applyEntitlementHardDeny,
  buildCandidatesFromPreferredModelOrder,
} from "./model-fallback.js";
import type { ModelCandidate } from "./model-fallback.types.js";

function c(provider: string, model: string): ModelCandidate {
  return { provider, model };
}

describe("applyEntitlementHardDeny — Property 7 hard deny", () => {
  it("剔除不在有效集合内的候选（含 explicit fallback）", () => {
    const candidates = [
      c("api-proxy-deepseek", "deepseek-chat"), // primary，未授权
      c("api-proxy-gpt", "gpt-5.2"), // 已授权
      c("custom-x", "mini"), // explicit fallback，未授权
    ];
    const effective = ["api-proxy-gpt/gpt-5.2"];
    const result = applyEntitlementHardDeny(candidates, effective);
    expect(result).toEqual([c("api-proxy-gpt", "gpt-5.2")]);
  });

  it("primary 不在集合内时被剔除（不保留任何越界项）", () => {
    const candidates = [c("api-proxy-deepseek", "deepseek-chat")];
    const result = applyEntitlementHardDeny(candidates, ["api-proxy-gpt/gpt-5.2"]);
    expect(result).toEqual([]);
  });

  it("空有效集合 → 全部剔除", () => {
    const candidates = [c("a", "b"), c("c", "d")];
    expect(applyEntitlementHardDeny(candidates, [])).toEqual([]);
  });

  it("全部在集合内 → 全保留且顺序不变", () => {
    const candidates = [c("a", "b"), c("c", "d")];
    const result = applyEntitlementHardDeny(candidates, ["a/b", "c/d"]);
    expect(result).toEqual(candidates);
  });

  it("空白/重复的有效项不影响判定", () => {
    const candidates = [c("a", "b")];
    const result = applyEntitlementHardDeny(candidates, [" a/b ", "a/b", ""]);
    expect(result).toEqual([c("a", "b")]);
  });

  it("preferredModelOrder 可直接构造授权候选顺序", () => {
    expect(
      buildCandidatesFromPreferredModelOrder([
        "api-proxy-gpt/gpt-5.2",
        "api-proxy-gpt/gpt-5.2",
        "",
        "api-proxy-deepseek/deepseek-chat",
      ]),
    ).toEqual([c("api-proxy-gpt", "gpt-5.2"), c("api-proxy-deepseek", "deepseek-chat")]);
  });
});
