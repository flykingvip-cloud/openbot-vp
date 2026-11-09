import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInjectedProtocolRunner,
  createLocalProtocolVerificationService,
  normalizeQualityScore,
} from "./admission/local-protocol-adapter.ts";
import {
  admitPooledModelAfterConnection,
  POOLED_HEALTHY_ADMISSION_REASON,
} from "./admission/pooled-admission.ts";
import { previewRoutingDecisionViaService } from "./admission/routing-decision-service.ts";
import {
  __resetCapabilityVerificationServiceForTest,
  bindCapabilityAdmissionGateway,
} from "./admission/verification-service.ts";
import { verifiedCapabilityIds } from "./capability-evidence.ts";
import {
  assetHasCapability,
  assetMatchesRequiredCapabilities,
  normalizeCapabilityIds,
  toCanonicalCapabilityId,
} from "./capability-ids.ts";
import {
  __resetModelAdmissionStoreForTest,
  getModelAdmission,
  setAutoRoutingAdmission,
  upsertModelAdmission,
} from "./model-admission-store.ts";
import {
  detectTaskCategoryForPreview,
  previewRoutingDecision,
} from "./routing-decision-preview.ts";
import {
  SPECIALIZED_EVAL_DEMO_VERSION,
  buildSpecializedEvalDisplay,
  formatQualityScore,
  formatVerifiedAt,
  runDemoSpecializedEval,
} from "./specialized-eval.ts";
import type { ModelAsset } from "./view-model.ts";

function asset(partial: Partial<ModelAsset> & Pick<ModelAsset, "modelId">): ModelAsset {
  return {
    providerId: "private",
    displayName: partial.modelId,
    source: "configured",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: [],
    costTier: "medium",
    health: "healthy",
    taskTags: [],
    inRecommendationPool: true,
    tenantSelectable: false,
    autoRouting: "disabled",
    ...partial,
  };
}

describe("batch3 capability id alignment", () => {
  it("maps legacy code/tools to coding/tool_use for filters and matching", () => {
    expect(toCanonicalCapabilityId("code")).toBe("coding");
    expect(toCanonicalCapabilityId("tools")).toBe("tool_use");
    expect(normalizeCapabilityIds(["code", "tools", "coding"])).toEqual(["coding", "tool_use"]);
    expect(assetHasCapability(["coding", "reasoning"], "code")).toBe(true);
    expect(assetHasCapability(["tool_use"], "tools")).toBe(true);
    expect(assetMatchesRequiredCapabilities(["coding"], ["code", "coding"])).toBe(true);
    expect(assetMatchesRequiredCapabilities(["reasoning"], ["code"])).toBe(false);
  });
});

describe("batch3 routing trial preview", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
  });

  it("returns task category, executor, primary/fallback, and exclusion reasons", async () => {
    const candidates = [
      asset({ modelId: "private/a", autoRouting: "eligible", costTier: "high" }),
      asset({
        modelId: "private/b",
        autoRouting: "eligible",
        costTier: "low",
        contextWindow: 8_000,
      }),
      asset({
        modelId: "private/c",
        autoRouting: "eligible",
        costTier: "low",
        contextWindow: 200_000,
      }),
    ];
    setAutoRoutingAdmission("private/a", "eligible");
    setAutoRoutingAdmission("private/b", "eligible");
    setAutoRoutingAdmission("private/c", "eligible");
    upsertModelAdmission("private/c", {
      capabilityEvidence: [
        {
          id: "coding",
          label: "代码",
          source: "protocol_probe",
          status: "passed",
          verifiedAt: Date.now(),
          testVersion: "local-protocol-v1",
        },
      ],
    });

    const preview = await previewRoutingDecisionViaService({
      request: {
        taskText: "refactor this module",
        outputType: "text",
        budget: "low",
        requiredCapabilities: ["code"], // legacy tag must normalize
        minContextWindow: 100_000,
      },
      candidates,
    });

    expect(preview.uiDemo).toBe(true);
    expect(preview.dryRun).toBe(true);
    expect(preview.backendStatus).toBe("not_wired");
    expect(preview.banner).toMatch(/界面演示，非后端决策/);
    expect(preview.taskCategory).toBe("coding");
    expect(preview.executorPath).toMatch(/文本对话/);
    expect(preview.requiredCapabilities).toEqual(["coding"]);
    expect(preview.primary).toEqual(["private/c"]);
    expect(preview.selectedExecutor).toContain("private/c");
    expect(preview.excluded.some((e) => e.modelId === "private/a" && e.code === "budget")).toBe(
      true,
    );
    expect(
      preview.excluded.some((e) => e.modelId === "private/b" && e.code === "context_insufficient"),
    ).toBe(true);
  });

  it("excludes unverified models when route requires verified coding", () => {
    const candidates = [asset({ modelId: "private/unverified", autoRouting: "eligible" })];
    setAutoRoutingAdmission("private/unverified", "eligible");
    const preview = previewRoutingDecision({
      request: { taskText: "write unit tests", requiredCapabilities: ["tools", "code"] },
      candidates,
    });
    expect(preview.requiredCapabilities).toEqual(["tool_use", "coding"]);
    expect(preview.selectedModelId).toBeNull();
    expect(preview.excluded[0]?.code).toBe("capability_unverified");
    expect(preview.decisionReason).toMatch(/界面演示，非后端决策/);
  });
});

describe("batch3 specialized eval display", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
  });
  afterEach(() => {
    __resetModelAdmissionStoreForTest();
  });

  it("formats test version, time, and quality score", () => {
    expect(formatQualityScore(0.915)).toBe("92%");
    expect(formatVerifiedAt(1_700_000_000_000).length).toBeGreaterThan(4);
    const rows = buildSpecializedEvalDisplay({
      formal: [
        {
          id: "coding",
          label: "代码",
          source: "specialized_eval",
          status: "passed",
          verifiedAt: 1_700_000_000_000,
          testVersion: "eval-suite-v3",
          qualityScore: 0.88,
        },
      ],
      demo: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.testVersion).toBe("eval-suite-v3");
    expect(rows[0]?.qualityScoreLabel).toBe("88%");
    expect(rows[0]?.isDemo).toBe(false);
    expect(rows[0]?.verifiedAtLabel).not.toBe("未记录时间");
  });

  it("demo specialized eval stays out of formal verified set", () => {
    runDemoSpecializedEval({
      modelRef: "private/demo-eval",
      capabilityIds: ["coding"],
      scores: { coding: 0.91 },
    });
    const admission = getModelAdmission("private/demo-eval");
    expect(verifiedCapabilityIds(admission.capabilityEvidence)).toEqual([]);
    expect(admission.demoCapabilityEvidence?.[0]?.testVersion).toBe(SPECIALIZED_EVAL_DEMO_VERSION);
    expect(admission.demoCapabilityEvidence?.[0]?.source).toBe("specialized_eval");
    expect(admission.demoCapabilityEvidence?.[0]?.sourceNote).toMatch(/模拟结果/);

    const display = buildSpecializedEvalDisplay({
      formal: admission.capabilityEvidence,
      demo: admission.demoCapabilityEvidence,
    });
    expect(display.some((row) => row.isDemo && row.id === "coding")).toBe(true);
  });
});

describe("batch3 Chinese / mixed task classification", () => {
  it("classifies page Chinese coding example as coding", () => {
    expect(
      detectTaskCategoryForPreview({
        taskText: "重构这段代码并补充测试",
        outputType: "text",
      }),
    ).toBe("coding");
  });

  it("classifies Chinese poster / soundtrack and mixed EN+CN", () => {
    expect(detectTaskCategoryForPreview({ taskText: "画一张活动海报" })).toBe("image_generation");
    expect(detectTaskCategoryForPreview({ taskText: "为短片配乐" })).toBe("music_generation");
    expect(detectTaskCategoryForPreview({ taskText: "refactor 这段代码 and add 单元测试" })).toBe(
      "coding",
    );
    expect(detectTaskCategoryForPreview({ taskText: "generate a 海报 for launch" })).toBe(
      "image_generation",
    );
    expect(detectTaskCategoryForPreview({ taskText: "suno 风格配乐 for trailer" })).toBe(
      "music_generation",
    );
  });

  it("gives outputType priority over conflicting task text", () => {
    // Explicit image wins even when text talks about coding.
    expect(
      detectTaskCategoryForPreview({
        taskText: "重构这段代码并补充测试",
        outputType: "image",
      }),
    ).toBe("image_generation");
    // Explicit music wins over coding text.
    expect(
      detectTaskCategoryForPreview({
        taskText: "refactor this module",
        outputType: "music",
      }),
    ).toBe("music_generation");
    // Explicit text blocks promoting 海报/配乐 keywords from the description.
    expect(
      detectTaskCategoryForPreview({
        taskText: "写一段说明文，提到活动海报和配乐需求即可",
        outputType: "text",
      }),
    ).toBe("general_text");
  });

  it("falls back to strategy profile after text when no stronger signal", () => {
    expect(
      detectTaskCategoryForPreview({
        taskText: "随便聊聊",
        taskProfileId: "high_quality_reasoning",
      }),
    ).toBe("high_quality_reasoning");
  });

  it("does not turn plain text plus an image profile into image generation", () => {
    expect(
      detectTaskCategoryForPreview({
        taskText: "请帮我处理一下",
        taskProfileId: "image_generation",
      }),
    ).toBe("general_text");
  });

  it("does not let image_generation profile override clear coding task text", () => {
    expect(
      detectTaskCategoryForPreview({
        taskText: "重构这段代码并补充测试",
        taskProfileId: "image_generation",
      }),
    ).toBe("coding");
  });

  it("does not let image_generation profile override clear music task text", () => {
    expect(
      detectTaskCategoryForPreview({
        taskText: "写一段30秒配乐",
        taskProfileId: "image_generation",
      }),
    ).toBe("music_generation");
  });

  it("explicit text output does not fall back to image_generation profile", () => {
    expect(
      detectTaskCategoryForPreview({
        taskText: "请帮我处理一下",
        outputType: "text",
        taskProfileId: "image_generation",
      }),
    ).toBe("general_text");
  });

  it("explicit text output does not fall back to music_generation profile", async () => {
    expect(
      detectTaskCategoryForPreview({
        taskText: "请帮我处理一下",
        outputType: "text",
        taskProfileId: "music_generation",
      }),
    ).toBe("general_text");
  });

  it("explicit text still allows coding / reasoning profile fallback", async () => {
    expect(
      detectTaskCategoryForPreview({
        taskText: "请帮我处理一下",
        outputType: "text",
        taskProfileId: "coding",
      }),
    ).toBe("coding");
    expect(
      detectTaskCategoryForPreview({
        taskText: "请帮我处理一下",
        outputType: "text",
        taskProfileId: "high_quality_reasoning",
      }),
    ).toBe("high_quality_reasoning");
  });

  it("preview uses Chinese coding example for required capabilities", async () => {
    __resetModelAdmissionStoreForTest();
    const preview = previewRoutingDecision({
      request: { taskText: "重构这段代码并补充测试", outputType: "text" },
      candidates: [],
    });
    expect(preview.taskCategory).toBe("coding");
    expect(preview.requiredCapabilities).toEqual(["coding"]);
    expect(preview.uiDemo).toBe(true);
  });
});

describe("batch3 specialized score pipeline through protocol adapter", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
  });
  afterEach(() => {
    __resetModelAdmissionStoreForTest();
  });

  it("normalizeQualityScore keeps [0,1] finite only", () => {
    expect(normalizeQualityScore(0)).toBe(0);
    expect(normalizeQualityScore(1)).toBe(1);
    expect(normalizeQualityScore(0.88)).toBe(0.88);
    expect(normalizeQualityScore(Number.NaN)).toBeUndefined();
    expect(normalizeQualityScore(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizeQualityScore(-0.1)).toBeUndefined();
    expect(normalizeQualityScore(1.01)).toBeUndefined();
    expect(normalizeQualityScore("0.9")).toBeUndefined();
  });

  it("runner specialized score persists, rereads, and displays version/time/score", async () => {
    const verifiedAt = 1_700_000_000_000;
    const service = createLocalProtocolVerificationService({
      runner: createInjectedProtocolRunner({
        coding: {
          capabilityId: "coding",
          status: "passed",
          testVersion: "eval-suite-v3",
          verifiedAt,
          qualityScore: 0.88,
          sourceNote: "专项评测注入结果（测试）",
        },
      }),
      settleDelayMs: 0,
    });

    const { task, authority } = await service.createVerificationTask({
      modelRef: "private/score-pipe",
      capabilityIds: ["coding"],
      mode: "specialized_eval",
      configFingerprint: "fp-score-1",
    });
    expect(authority).toBe("formal");
    expect(task.status).toBe("succeeded");
    expect(task.results?.[0]?.qualityScore).toBe(0.88);
    expect(task.results?.[0]?.testVersion).toBe("eval-suite-v3");
    expect(task.results?.[0]?.source).toBe("specialized_eval");

    const admission = getModelAdmission("private/score-pipe");
    const persisted = admission.capabilityEvidence.find((e) => e.id === "coding");
    expect(persisted?.qualityScore).toBe(0.88);
    expect(persisted?.testVersion).toBe("eval-suite-v3");
    expect(persisted?.verifiedAt).toBe(verifiedAt);
    expect(persisted?.source).toBe("specialized_eval");

    // Re-read path: build display from persisted formal evidence.
    const rows = buildSpecializedEvalDisplay({
      formal: getModelAdmission("private/score-pipe").capabilityEvidence,
      demo: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.testVersion).toBe("eval-suite-v3");
    expect(rows[0]?.qualityScore).toBe(0.88);
    expect(rows[0]?.qualityScoreLabel).toBe("88%");
    expect(rows[0]?.verifiedAtLabel).not.toBe("未记录时间");
    expect(rows[0]?.isDemo).toBe(false);
  });

  it("drops out-of-range qualityScore instead of persisting it", async () => {
    const service = createLocalProtocolVerificationService({
      runner: createInjectedProtocolRunner({
        coding: {
          capabilityId: "coding",
          status: "passed",
          testVersion: "eval-suite-v3",
          qualityScore: 1.5,
        },
      }),
      settleDelayMs: 0,
    });
    const { task } = await service.createVerificationTask({
      modelRef: "private/bad-score",
      capabilityIds: ["coding"],
      mode: "specialized_eval",
    });
    expect(task.status).toBe("succeeded");
    const persisted = getModelAdmission("private/bad-score").capabilityEvidence.find(
      (e) => e.id === "coding",
    );
    expect(persisted?.status).toBe("passed");
    expect(persisted?.qualityScore).toBeUndefined();
  });
});

describe("pooled connection writes executable admission", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
    __resetCapabilityVerificationServiceForTest();
  });

  it("writes eligible admission through the gateway when no row exists", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    await bindCapabilityAdmissionGateway(
      async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
        calls.push({ method, params });
        if (method === "models.admission.listModelAdmissions") {
          return { admissions: [] } as T;
        }
        if (method === "models.admission.setRoutingEligibility") {
          return {
            status: "applied",
            modelRef: params?.modelRef,
            autoRouting: params?.autoRouting,
            admission: {
              modelRef: params?.modelRef,
              autoRouting: "eligible",
              tenantSelectable: false,
              autoRoutingTaskCategories: [],
              capabilityEvidence: [],
              updatedAt: 1,
              platformEffective: true,
              autoRoutingReason: params?.reason,
            },
          } as T;
        }
        return {} as T;
      },
    );
    expect(await admitPooledModelAfterConnection("api-proxy-deepseek/deepseek-v4-flash")).toBe(
      true,
    );
    expect(
      calls.find((call) => call.method === "models.admission.setRoutingEligibility")?.params,
    ).toMatchObject({
      modelRef: "api-proxy-deepseek/deepseek-v4-flash",
      autoRouting: "eligible",
      reason: POOLED_HEALTHY_ADMISSION_REASON,
    });
  });

  it("leaves an existing gateway admission row unchanged", async () => {
    upsertModelAdmission("api-proxy-deepseek/deepseek-v4-flash", {
      autoRouting: "paused",
      autoRoutingReason: "管理员暂停",
      platformEffective: true,
    });
    const calls: string[] = [];
    await bindCapabilityAdmissionGateway(async <T>(method: string): Promise<T> => {
      calls.push(method);
      if (method === "models.admission.listModelAdmissions") {
        return { admissions: [] } as T;
      }
      return {} as T;
    });
    expect(await admitPooledModelAfterConnection("api-proxy-deepseek/deepseek-v4-flash")).toBe(
      false,
    );
    expect(calls).not.toContain("models.admission.setRoutingEligibility");
  });
});
