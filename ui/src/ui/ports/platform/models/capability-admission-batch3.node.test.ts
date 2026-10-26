import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { previewRoutingDecisionViaService } from "./admission/routing-decision-service.ts";
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
import { previewRoutingDecision } from "./routing-decision-preview.ts";
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

  it("returns task category, executor, primary/fallback, and exclusion reasons", () => {
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

    const preview = previewRoutingDecisionViaService({
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
