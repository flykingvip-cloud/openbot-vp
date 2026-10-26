// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildTaskCapabilityPlan,
  classifyTaskCapability,
  filterExecutableModelIds,
  resolveExecutionRoutingFromCapabilityPlan,
} from "./task-capability-plan.js";

describe("classifyTaskCapability (P0)", () => {
  it("classifies design.image vs design.review distinctly", () => {
    const poster = classifyTaskCapability("帮我画一张产品海报");
    expect(poster.categoryId).toBe("design.image");
    expect(poster.executor).toBe("image_generation");

    const review = classifyTaskCapability("请做一次设计评审，点评这个交互稿");
    expect(review.categoryId).toBe("design.review");
    expect(review.executor).toBe("chat_model");
  });

  it("splits audio.music_gen from audio.tts", () => {
    const music = classifyTaskCapability("写一段 30 秒配乐");
    expect(music.categoryId).toBe("audio.music_gen");
    expect(music.executor).toBe("audio_music_generation");

    const tts = classifyTaskCapability("把这段话念出来");
    expect(tts.categoryId).toBe("audio.tts");
    expect(tts.executor).toBe("audio_tts");
  });

  it("falls back to heuristic_default without expanding rights", () => {
    const res = classifyTaskCapability("随便聊聊天气");
    expect(res.categoryId).toBe("default");
    expect(res.classificationSource).toBe("heuristic_default");
  });
});

describe("filterExecutableModelIds (P0 context constraint)", () => {
  it("excludes context-insufficient models from the executable set", () => {
    const { executableModelIds, excluded } = filterExecutableModelIds({
      authorizedModelIds: ["a/small", "b/large"],
      modelContextWindows: { "a/small": 1000, "b/large": 200_000 },
      estimatedInputTokens: 50_000,
    });
    expect(executableModelIds).toEqual(["b/large"]);
    expect(excluded.map((e) => e.modelId)).toEqual(["a/small"]);
  });

  it("keeps models with unknown context windows", () => {
    const { executableModelIds } = filterExecutableModelIds({
      authorizedModelIds: ["x/unknown"],
      estimatedInputTokens: 50_000,
    });
    expect(executableModelIds).toEqual(["x/unknown"]);
  });
});

describe("buildTaskCapabilityPlan (P0)", () => {
  it("never expands beyond the authorized set", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "refactor this payment webhook",
      authorizedModelIds: ["openai/gpt-5.4-mini"],
      preferredModelOrderFromAuth: ["openai/gpt-5.4-mini", "anthropic/claude-opus-4-6"],
    });
    expect(plan.authorizedModelIds).toEqual(["openai/gpt-5.4-mini"]);
    expect(plan.executableModelIds.every((id) => id === "openai/gpt-5.4-mini")).toBe(true);
    expect(plan.preferredModelOrder).toEqual(["openai/gpt-5.4-mini"]);
    expect(plan.categoryId).toBe("coding.refactor");
    expect(plan.reasons.length).toBeGreaterThan(0);
    expect(plan.failure.kind).toBe("none");
  });

  it("marks no_executable_candidates when nothing fits context", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "summarize this long document",
      authorizedModelIds: ["a/tiny"],
      modelContextWindows: { "a/tiny": 512 },
      estimatedInputTokens: 20_000,
    });
    expect(plan.executableModelIds).toEqual([]);
    expect(plan.preferredModelOrder).toEqual([]);
    expect(plan.failure.kind).toBe("no_executable_candidates");
  });

  it("degrades unwired image executor to chat_model with explicit failure", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "generate an illustration poster",
      authorizedModelIds: ["openai/gpt-5.4"],
    });
    expect(plan.categoryId).toBe("design.image");
    expect(plan.executor).toBe("chat_model");
    expect(plan.failure.kind).toBe("executor_unwired");
  });

  it("resolveExecutionRouting switches run allowlist to executable set", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "hello",
      authorizedModelIds: ["a/small", "b/large"],
      modelContextWindows: { "a/small": 100, "b/large": 100_000 },
      estimatedInputTokens: 10_000,
    });
    const routing = resolveExecutionRoutingFromCapabilityPlan({
      allowlist: plan.authorizedModelIds,
      preferredModelOrder: ["a/small", "b/large"],
      capabilityPlan: plan,
    });
    expect(routing.allowlist).toEqual(["b/large"]);
    expect(routing.preferredModelOrder).toEqual(["b/large"]);
    // authorized set on the plan is unchanged
    expect(plan.authorizedModelIds).toEqual(["a/small", "b/large"]);
  });
});
