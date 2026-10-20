import { describe, expect, it } from "vitest";
import {
  ensureAssetSuggestionPatternRuntime,
  decideAssetSuggestionFromChatFinal,
  decideAssetSuggestionFromManualIteration,
} from "./asset-suggestion-trigger.ts";

describe("asset suggestion trigger", () => {
  it("does not treat a single structured final as multi-task stable pattern", () => {
    const decision = decideAssetSuggestionFromChatFinal({
      runId: "run-1",
      sessionKey: "agent:main:main",
      state: "final",
      message: {
        role: "assistant",
        artifactId: "artifact-1",
        text: "任务完成总结",
      },
    });

    // sampleCount starts at 1; thresholds require minRepetitions=3 independent observations.
    expect(decision.shouldSuggest).toBe(false);
    expect(decision.source).toBe("assistant-task-complete");
    expect(decision.contextId).toBe("artifact-1");
  });

  it("suggests only after three independent structured finals (real sampleCount)", () => {
    const owner = {};
    const runtime = ensureAssetSuggestionPatternRuntime(owner, null, false);
    const payloadBase = {
      sessionKey: "space:product",
      state: "final" as const,
      message: {
        role: "assistant",
        text: "✅ 任务完成总结\n\n# 售后复盘\n1. 问题\n2. 原因\n3. 后续动作",
      },
    };
    const first = decideAssetSuggestionFromChatFinal({ ...payloadBase, runId: "run-1" }, runtime);
    const second = decideAssetSuggestionFromChatFinal({ ...payloadBase, runId: "run-2" }, runtime);
    const third = decideAssetSuggestionFromChatFinal({ ...payloadBase, runId: "run-3" }, runtime);

    expect(first.shouldSuggest).toBe(false);
    expect(second.shouldSuggest).toBe(false);
    expect(third.shouldSuggest).toBe(true);
    expect(third.source).toBe("group-task-complete");
    expect(third.hint?.signals.some((s) => s.sampleCount >= 3)).toBe(true);
  });

  it("does not suggest for short unstructured completions", () => {
    const decision = decideAssetSuggestionFromChatFinal({
      runId: "run-3",
      sessionKey: "agent:main:main",
      state: "final",
      message: {
        role: "assistant",
        text: "已完成。",
      },
    });

    expect(decision.shouldSuggest).toBe(false);
  });

  it("suggests after manual iteration when capability id exists", () => {
    const decision = decideAssetSuggestionFromManualIteration({
      capabilityId: "cap-1",
      capabilityName: "客户周报模版",
    });

    expect(decision.shouldSuggest).toBe(true);
    expect(decision.source).toBe("manual-iteration");
    expect(decision.contextId).toBe("cap-1");
  });

  it("accumulates repeated weak completions into a valid suggestion only after 3 runs", () => {
    const owner = {};
    const runtime = ensureAssetSuggestionPatternRuntime(owner, null, false);

    const first = decideAssetSuggestionFromChatFinal(
      {
        runId: "run-1",
        sessionKey: "space:product",
        state: "final",
        message: {
          role: "assistant",
          text: "✅ 任务完成总结",
        },
      },
      runtime,
    );
    const second = decideAssetSuggestionFromChatFinal(
      {
        runId: "run-2",
        sessionKey: "space:product",
        state: "final",
        message: {
          role: "assistant",
          text: "✅ 任务完成总结\n\n# 复盘结论",
        },
      },
      runtime,
    );
    const third = decideAssetSuggestionFromChatFinal(
      {
        runId: "run-3",
        sessionKey: "space:product",
        state: "final",
        message: {
          role: "assistant",
          text: "✅ 任务完成总结\n\n# 复盘结论\n- 动作",
        },
      },
      runtime,
    );

    expect(first.shouldSuggest).toBe(false);
    expect(second.shouldSuggest).toBe(false);
    expect(third.shouldSuggest).toBe(true);
  });

  it("persists aggregated hints across runtimes", () => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });

    const ownerA = {};
    const runtimeA = ensureAssetSuggestionPatternRuntime(ownerA, null, false);
    decideAssetSuggestionFromChatFinal(
      {
        runId: "run-1",
        sessionKey: "space:product",
        state: "final",
        message: {
          role: "assistant",
          text: "✅ 任务完成总结\n\n# 复盘结论",
        },
      },
      runtimeA,
    );

    const ownerB = {};
    const runtimeB = ensureAssetSuggestionPatternRuntime(ownerB, null, false);
    expect(runtimeB.aggregatedHintsByScope.has("space:product")).toBe(true);
  });

  it("does not suggest from local heuristic when gateway is connected", () => {
    const owner = {};
    const runtime = ensureAssetSuggestionPatternRuntime(owner, null, true);
    const payloadBase = {
      sessionKey: "space:product",
      state: "final" as const,
      message: {
        role: "assistant",
        text: "✅ 任务完成总结\n\n# 售后复盘\n1. 问题\n2. 原因\n3. 后续动作",
      },
    };
    for (let i = 1; i <= 3; i += 1) {
      const decision = decideAssetSuggestionFromChatFinal(
        { ...payloadBase, runId: `run-${i}` },
        runtime,
      );
      expect(decision.shouldSuggest).toBe(false);
    }
  });
});
