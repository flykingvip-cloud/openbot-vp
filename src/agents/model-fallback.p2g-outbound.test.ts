// @vitest-environment node
/**
 * P2-G — prove task-type/policy AOR order changes the real outbound primary
 * provider/model emitted by runWithModelFallback (decision matches call).
 */
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/types.js";
import { selectModelOrderWithinEffectiveSet } from "../gateway/model-entitlement/aor-selection.js";
import { runWithModelFallback } from "./model-fallback.js";

function makeCfg(primary: string, fallbacks: string[]): OpenBotConfig {
  return {
    agents: {
      defaults: {
        model: { primary, fallbacks },
      },
    },
    models: {
      providers: {
        "api-proxy-deepseek": {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [{ id: "cheap" }, { id: "premium" }],
        },
      },
    },
  } as unknown as OpenBotConfig;
}

const CATALOG = [
  {
    ref: { provider: "api-proxy-deepseek", id: "cheap" },
    cost: { inputPerMtok: 0.1, outputPerMtok: 0.2 },
    taskTypeScores: { coding: 0.4 },
  },
  {
    ref: { provider: "api-proxy-deepseek", id: "premium" },
    cost: { inputPerMtok: 10, outputPerMtok: 20 },
    taskTypeScores: { coding: 0.95 },
  },
];

describe("P2-G outbound provider/model matches AOR decision", () => {
  it("cheapest preferredModelOrder makes cheap the first outbound call", async () => {
    const effective = ["api-proxy-deepseek/premium", "api-proxy-deepseek/cheap"];
    const selection = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: effective,
      aorExecution: {
        taskTypeId: "default",
        selectorStrategy: "cheapest",
        evaluatorMode: "content",
      },
      catalog: CATALOG,
    });
    expect(selection.strategy).toBe("cheapest");
    expect(selection.catalogCoverage).toBe("full");
    expect(selection.orderedModelIds[0]).toBe("api-proxy-deepseek/cheap");

    const calls: string[] = [];
    const cfg = makeCfg("api-proxy-deepseek/premium", ["api-proxy-deepseek/cheap"]);
    await runWithModelFallback({
      cfg,
      provider: "api-proxy-deepseek",
      model: "premium",
      preferredModelOrder: selection.orderedModelIds,
      run: async (provider, model) => {
        calls.push(`${provider}/${model}`);
        return "ok";
      },
    });
    expect(calls[0]).toBe(selection.orderedModelIds[0]);
    expect(calls[0]).toBe("api-proxy-deepseek/cheap");
  });

  it("best_quality preferredModelOrder makes premium the first outbound call", async () => {
    const effective = ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"];
    const selection = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: effective,
      aorExecution: {
        taskTypeId: "coding",
        selectorStrategy: "best_quality",
        evaluatorMode: "content",
      },
      catalog: CATALOG,
    });
    expect(selection.strategy).toBe("best_quality");
    expect(selection.orderedModelIds[0]).toBe("api-proxy-deepseek/premium");

    const calls: string[] = [];
    const cfg = makeCfg("api-proxy-deepseek/cheap", ["api-proxy-deepseek/premium"]);
    await runWithModelFallback({
      cfg,
      provider: "api-proxy-deepseek",
      model: "cheap",
      preferredModelOrder: selection.orderedModelIds,
      run: async (provider, model) => {
        calls.push(`${provider}/${model}`);
        return "ok";
      },
    });
    expect(calls[0]).toBe("api-proxy-deepseek/premium");
  });

  it("synthetic_only selection does not reorder outbound primary (no fake optimization)", async () => {
    const effective = ["api-proxy-deepseek/premium", "api-proxy-deepseek/cheap"];
    const selection = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: effective,
      aorExecution: {
        taskTypeId: "default",
        selectorStrategy: "cheapest",
        evaluatorMode: "content",
      },
      catalog: [],
    });
    expect(selection.strategy).toBe("native");
    expect(selection.catalogCoverage).toBe("synthetic_only");

    // Callers only pass preferredModelOrder when strategy !== native (gate contract).
    const preferred = selection.strategy !== "native" ? selection.orderedModelIds : undefined;
    const calls: string[] = [];
    const cfg = makeCfg("api-proxy-deepseek/premium", ["api-proxy-deepseek/cheap"]);
    await runWithModelFallback({
      cfg,
      provider: "api-proxy-deepseek",
      model: "premium",
      ...(preferred ? { preferredModelOrder: preferred } : {}),
      run: async (provider, model) => {
        calls.push(`${provider}/${model}`);
        return "ok";
      },
    });
    expect(calls[0]).toBe("api-proxy-deepseek/premium");
  });
});
