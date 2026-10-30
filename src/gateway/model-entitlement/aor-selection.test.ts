// @vitest-environment node
// Feature: model-entitlement-chain, P3 任务 13.1（双模式候选一致 + hard-deny 不越界）
import { SEED_MODEL_CATALOG } from "@openbot/aor-core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { selectModelOrderWithinEffectiveSet, type AorExecutionSpec } from "./aor-selection.js";

const AOR: AorExecutionSpec = {
  taskTypeId: "summarization",
  selectorStrategy: "cheapest",
  evaluatorMode: "content",
};

const CATALOG_IDS = ["anthropic/claude-opus-4-6", "openai/gpt-5.4", "openai/gpt-5.4-mini"];

function sortedSet(ids: readonly string[]): string[] {
  return [...new Set(ids)].toSorted();
}

describe("selectModelOrderWithinEffectiveSet", () => {
  it("native 模式按原序返回，strategy=native", () => {
    const res = selectModelOrderWithinEffectiveSet({
      mode: "native",
      effectiveModelIds: CATALOG_IDS,
      aorExecution: AOR,
    });
    expect(res.strategy).toBe("native");
    expect(res.orderedModelIds).toEqual(CATALOG_IDS);
    expect(res.routingExplanation).toBeUndefined();
  });

  it("aor_enhanced 无 aorExecution 时退回原序", () => {
    const res = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: CATALOG_IDS,
    });
    expect(res.strategy).toBe("native");
    expect(res.orderedModelIds).toEqual(CATALOG_IDS);
  });

  it("cheapest 策略把最便宜模型排到首位（集合不变）", () => {
    const res = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: CATALOG_IDS,
      aorExecution: { ...AOR, selectorStrategy: "cheapest" },
      // Explicit test seed catalog — production must pass platform catalog profiles.
      catalog: SEED_MODEL_CATALOG,
    });
    expect(res.strategy).toBe("cheapest");
    // gpt-5.4-mini 是目录里最便宜的。
    expect(res.orderedModelIds[0]).toBe("openai/gpt-5.4-mini");
    expect(sortedSet(res.orderedModelIds)).toEqual(sortedSet(CATALOG_IDS));
  });

  it("best_quality 策略把最高质量模型排到首位", () => {
    const res = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: CATALOG_IDS,
      catalog: SEED_MODEL_CATALOG,
      aorExecution: { ...AOR, selectorStrategy: "best_quality" },
    });
    expect(res.orderedModelIds[0]).toBe("anthropic/claude-opus-4-6");
    expect(sortedSet(res.orderedModelIds)).toEqual(sortedSet(CATALOG_IDS));
  });

  it("集合外模型不会被引入（hard-deny 边界）；不可解析 id 仍保留在集合内", () => {
    const ids = ["anthropic/claude-opus-4-6", "weird-no-slash", "custom/unknown-model"];
    const res = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: ids,
      aorExecution: AOR,
    });
    expect(sortedSet(res.orderedModelIds)).toEqual(sortedSet(ids));
    // 不引入任何 effective 之外的成员。
    for (const id of res.orderedModelIds) {
      expect(ids).toContain(id);
    }
  });

  it("P2-G: empty catalog must not claim cheapest / fake cost explanations", () => {
    const ids = ["api-proxy-deepseek/premium", "api-proxy-deepseek/cheap", "openai/gpt-x"];
    const res = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: ids,
      aorExecution: AOR,
      catalog: [],
    });
    expect(res.strategy).toBe("native");
    expect(res.catalogCoverage).toBe("synthetic_only");
    expect(res.orderedModelIds).toEqual(ids);
    expect(res.routingExplanation).toBeUndefined();
    expect(res.syntheticModelIds?.toSorted()).toEqual(
      ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium", "openai/gpt-x"].toSorted(),
    );
  });

  it("P2-G: partial catalog still ranks on real costs; marks synthetic peers", () => {
    const ids = ["api-proxy-deepseek/premium", "api-proxy-deepseek/cheap", "openai/gpt-x"];
    const res = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: ids,
      aorExecution: { ...AOR, selectorStrategy: "cheapest" },
      catalog: [
        {
          ref: { provider: "api-proxy-deepseek", id: "cheap" },
          cost: { inputPerMtok: 0.1, outputPerMtok: 0.2 },
          taskTypeScores: {},
        },
        {
          ref: { provider: "api-proxy-deepseek", id: "premium" },
          cost: { inputPerMtok: 10, outputPerMtok: 20 },
          taskTypeScores: {},
        },
      ],
    });
    expect(res.strategy).toBe("cheapest");
    expect(res.catalogCoverage).toBe("partial");
    expect(res.orderedModelIds[0]).toBe("api-proxy-deepseek/cheap");
    expect(res.syntheticModelIds).toEqual(["openai/gpt-x"]);
    // Synthetic peers are appended after real-ranked models (do not enter rankModels).
    expect(res.orderedModelIds.at(-1)).toBe("openai/gpt-x");
    expect(sortedSet(res.orderedModelIds)).toEqual(sortedSet(ids));
  });

  it("P2-G: synthetic neutral cost must not win cheapest over real expensive catalog peers", () => {
    // Real premium is expensive; synthetic gpt-x would invent cost 1/1 and falsely win
    // cheapest if allowed into rankModels. Gate synthetics out of ranking claims.
    const ids = ["api-proxy-deepseek/premium", "openai/gpt-x"];
    const res = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: ids,
      aorExecution: { ...AOR, selectorStrategy: "cheapest" },
      catalog: [
        {
          ref: { provider: "api-proxy-deepseek", id: "premium" },
          cost: { inputPerMtok: 10, outputPerMtok: 20 },
          taskTypeScores: {},
        },
      ],
    });
    expect(res.catalogCoverage).toBe("partial");
    expect(res.strategy).toBe("cheapest");
    expect(res.orderedModelIds[0]).toBe("api-proxy-deepseek/premium");
    expect(res.orderedModelIds[1]).toBe("openai/gpt-x");
    expect(res.syntheticModelIds).toEqual(["openai/gpt-x"]);
    // Explanations must only cover real-ranked models (no fake synthetic cost claim).
    expect(res.routingExplanation?.map((e) => e.modelId)).toEqual(["api-proxy-deepseek/premium"]);
  });

  it("Property 4 + 7：任意授权集合下，native 与 aor_enhanced 候选集合恒等", () => {
    const arbId = fc.constantFrom(...CATALOG_IDS, "custom/x", "custom/y", "no-slash");
    fc.assert(
      fc.property(
        fc.uniqueArray(arbId),
        fc.constantFrom<AorExecutionSpec["selectorStrategy"]>(
          "cheapest",
          "best_quality",
          "balanced",
          "bandit",
        ),
        (effectiveModelIds, strategy) => {
          const nativeRes = selectModelOrderWithinEffectiveSet({
            mode: "native",
            effectiveModelIds,
            aorExecution: { ...AOR, selectorStrategy: strategy },
          });
          const aorRes = selectModelOrderWithinEffectiveSet({
            mode: "aor_enhanced",
            effectiveModelIds,
            aorExecution: { ...AOR, selectorStrategy: strategy },
            catalog: SEED_MODEL_CATALOG,
          });
          // 集合恒等（仅排序可能不同）。
          expect(sortedSet(aorRes.orderedModelIds)).toEqual(sortedSet(nativeRes.orderedModelIds));
          expect(sortedSet(nativeRes.orderedModelIds)).toEqual(sortedSet(effectiveModelIds));
          // hard-deny：AOR 输出全部在授权集合内。
          const allowed = new Set(effectiveModelIds);
          for (const id of aorRes.orderedModelIds) {
            expect(allowed.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
