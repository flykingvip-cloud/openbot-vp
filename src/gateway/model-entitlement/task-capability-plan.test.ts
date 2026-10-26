// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildTaskCapabilityPlan,
  classifyTaskCapability,
  estimateTaskContextTokens,
  filterExecutableModelIds,
  resolveCapabilityExecutionSurface,
  resolveCapabilityPlanOutcomeClaim,
  resolveExecutionRoutingFromCapabilityPlan,
} from "./task-capability-plan.js";

describe("classifyTaskCapability (P0/P1)", () => {
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

  it("P1: Chinese 重构 hits coding.refactor", () => {
    const res = classifyTaskCapability("帮我重构这段支付回调");
    expect(res.categoryId).toBe("coding.refactor");
    expect(res.classificationSource).toBe("task_text");
  });

  it("falls back to heuristic_default without expanding rights", () => {
    const res = classifyTaskCapability("随便聊聊天气");
    expect(res.categoryId).toBe("default");
    expect(res.classificationSource).toBe("heuristic_default");
  });
});

describe("estimateTaskContextTokens (P1 full context)", () => {
  it("sums history, system, tools, attachments, task, and output reserve", () => {
    const est = estimateTaskContextTokens({
      taskText: "hello world", // ~3 tokens
      historyText: "a".repeat(40), // 10 tokens
      systemPromptText: "b".repeat(20), // 5 tokens
      toolsText: "c".repeat(8), // 2 tokens
      attachmentsText: "d".repeat(16), // 4 tokens
      outputReserveTokens: 500,
    });
    expect(est.breakdown.outputReserve).toBe(500);
    expect(est.estimatedInputTokens).toBe(
      est.breakdown.taskText +
        est.breakdown.history +
        est.breakdown.systemPrompt +
        est.breakdown.tools +
        est.breakdown.attachments,
    );
    expect(est.totalRequiredTokens).toBe(est.estimatedInputTokens + 500);
    expect(est.estimateInsufficient).toBe(false);
    expect(est.reasons.some((r) => r.includes("context_breakdown"))).toBe(true);
  });

  it("marks estimate_insufficient when no input parts", () => {
    const est = estimateTaskContextTokens({ outputReserveTokens: 256 });
    expect(est.estimateInsufficient).toBe(true);
    expect(est.reasons.some((r) => r.includes("estimate_insufficient"))).toBe(true);
    expect(est.totalRequiredTokens).toBe(256);
  });
});

describe("filterExecutableModelIds (P0/P1 context constraint)", () => {
  it("excludes context-insufficient models from the executable set", () => {
    const { executableModelIds, excluded } = filterExecutableModelIds({
      authorizedModelIds: ["a/small", "b/large"],
      modelContextWindows: { "a/small": 1000, "b/large": 200_000 },
      totalRequiredTokens: 50_000,
    });
    expect(executableModelIds).toEqual(["b/large"]);
    expect(excluded.map((e) => e.modelId)).toEqual(["a/small"]);
    expect(excluded[0]?.reason).toContain("requiredTokens");
  });

  it("keeps models with unknown context windows by default with reason", () => {
    const { executableModelIds, keptUnknownWindow } = filterExecutableModelIds({
      authorizedModelIds: ["x/unknown"],
      totalRequiredTokens: 50_000,
    });
    expect(executableModelIds).toEqual(["x/unknown"]);
    expect(keptUnknownWindow[0]?.reason).toContain("unknown_context_window:kept");
  });

  it("excludes unknown windows when policy=exclude", () => {
    const { executableModelIds, excluded } = filterExecutableModelIds({
      authorizedModelIds: ["x/unknown"],
      totalRequiredTokens: 50_000,
      unknownContextWindowPolicy: "exclude",
    });
    expect(executableModelIds).toEqual([]);
    expect(excluded[0]?.reason).toContain("unknown_context_window:excluded");
  });
});

describe("buildTaskCapabilityPlan (P0/P1)", () => {
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

  it("P1: over-context models cannot re-enter via preferredModelOrder / fallback", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "hello",
      authorizedModelIds: ["a/small", "b/large"],
      preferredModelOrderFromAuth: ["a/small", "b/large"],
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
    expect(routing.allowlist).not.toContain("a/small");
    expect(plan.authorizedModelIds).toEqual(["a/small", "b/large"]);
  });

  it("P1: executor_unwired propagates to outcome claim; chat cannot claim image/music success", () => {
    const imagePlan = buildTaskCapabilityPlan({
      taskText: "画一张产品海报",
      authorizedModelIds: ["openai/gpt-5.4"],
    });
    const imageClaim = resolveCapabilityPlanOutcomeClaim(imagePlan);
    expect(imagePlan.failure.kind).toBe("executor_unwired");
    expect(imageClaim.allowedModality).toBe("chat_model");
    expect(imageClaim.forbiddenSuccessModalities).toContain("image_generation");

    const musicPlan = buildTaskCapabilityPlan({
      taskText: "写一段配乐",
      authorizedModelIds: ["openai/gpt-5.4"],
    });
    const musicClaim = resolveCapabilityPlanOutcomeClaim(musicPlan);
    expect(musicClaim.forbiddenSuccessModalities).toContain("audio_music_generation");

    const routing = resolveExecutionRoutingFromCapabilityPlan({
      capabilityPlan: imagePlan,
    });
    expect(routing.planFailure.kind).toBe("executor_unwired");
    expect(routing.outcomeClaim?.forbiddenSuccessModalities).toContain("image_generation");
  });

  it("P1: full contextParts drive requiredTokens exclusion", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "x",
      authorizedModelIds: ["a/small", "b/large"],
      modelContextWindows: { "a/small": 2000, "b/large": 200_000 },
      contextParts: {
        taskText: "short",
        historyText: "h".repeat(4000),
        systemPromptText: "s".repeat(400),
        toolsText: "t".repeat(400),
        attachmentsText: "a".repeat(400),
        outputReserveTokens: 2000,
      },
    });
    expect(plan.contextEstimate?.totalRequiredTokens).toBeGreaterThan(2000);
    expect(plan.executableModelIds).toEqual(["b/large"]);
    expect(plan.preferredModelOrder).not.toContain("a/small");
  });
});

describe("estimateInsufficient + executionSurface (NEEDS WORK)", () => {
  it("P1 NEEDS WORK: estimateInsufficient when unknownParts present even if tokens > 0", () => {
    const est = estimateTaskContextTokens({
      taskText: "hello world this has tokens",
      unknownParts: ["history", "tools"],
    });
    expect(est.estimatedInputTokens).toBeGreaterThan(0);
    expect(est.estimateIncomplete).toBe(true);
    expect(est.estimateInsufficient).toBe(true);
    expect(est.unknownParts).toEqual(["history", "tools"]);
  });

  it("P1 NEEDS WORK: executionSurface distinguishes text vs unwired modality", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "画一张产品海报",
      authorizedModelIds: ["openai/gpt-5.4"],
    });
    const claim = resolveCapabilityPlanOutcomeClaim(plan);
    const surface = resolveCapabilityExecutionSurface(claim);
    expect(surface.textReturnedAllowed).toBe(true);
    expect(surface.targetModalityCompleted).toBe(false);
    expect(surface.status).toBe("executor_unwired");
    const routing = resolveExecutionRoutingFromCapabilityPlan({ capabilityPlan: plan });
    expect(routing.executionSurface?.targetModalityCompleted).toBe(false);
    expect(routing.executionSurface?.textReturnedAllowed).toBe(true);
  });
});

describe("plan ≠ completion (routing ok leaves targetModalityCompleted false)", () => {
  it("ok chat plan is executable but not completed", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "summarize this note",
      authorizedModelIds: ["openai/gpt-5.4"],
    });
    expect(plan.failure.kind).toBe("none");
    const claim = resolveCapabilityPlanOutcomeClaim(plan);
    const surface = resolveCapabilityExecutionSurface(claim);
    expect(surface.status).toBe("ok");
    expect(surface.targetModalityCompleted).toBe(false);
    expect(surface.textReturnedAllowed).toBe(true);
  });
});
