import { describe, expect, it } from "vitest";
import {
  humanizeModelSlug,
  parseScopedModelId,
  resolveModelAssetLifecycleStage,
  resolveModelAssetPresentation,
  tenantSelectableLabel,
} from "./model-asset-presentation.ts";
import type { ModelAsset } from "./view-model.ts";

function baseAsset(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return {
    modelId: "deepseek/deepseek-v4-flash",
    providerId: "deepseek",
    displayName: "DeepSeek V4 Flash",
    source: "configured",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: [],
    costTier: "unknown",
    health: "healthy",
    taskTags: [],
    inRecommendationPool: true,
    tenantSelectable: true,
    ...overrides,
  };
}

describe("resolveModelAssetPresentation", () => {
  it("humanizes tenant-scoped raw model ids", () => {
    const presentation = resolveModelAssetPresentation({
      name: "cea43bf898/deepseek-v4-flash",
      modelId: "ent/cea43bf898/deepseek-v4-flash",
      providerId: "ent",
      providerName: "ent",
    });
    expect(presentation.title).toBe("Deepseek V4 Flash");
    expect(presentation.subtitle).toBe("ent · deepseek-v4-flash");
    expect(presentation.badges).toContain("租户专属");
    expect(presentation.avatarLabel).toBe("EN");
  });

  it("keeps readable names and strips BYOK suffix into badge", () => {
    const presentation = resolveModelAssetPresentation({
      name: "DeepSeek V4 Flash (BYOK Radeon)",
      modelId: "deepseek-v4-flash",
      providerId: "radeon-cloud",
      providerName: "Radeon Cloud",
    });
    expect(presentation.title).toBe("DeepSeek V4 Flash");
    expect(presentation.badges).toEqual(["BYOK"]);
    expect(presentation.subtitle).toBe("Radeon Cloud · deepseek-v4-flash");
  });

  it("derives title from slug when name is missing", () => {
    const presentation = resolveModelAssetPresentation({
      modelId: "qwen3.6-35b-a3b",
      providerId: "google",
      providerName: "Google",
    });
    expect(presentation.title).toBe("Qwen3.6 35b A3b");
  });
});

describe("parseScopedModelId", () => {
  it("detects tenant hash prefixes", () => {
    expect(parseScopedModelId("cea43bf898/deepseek-v4-flash")).toEqual({
      tenantScopeId: "cea43bf898",
      localModelId: "deepseek-v4-flash",
    });
  });

  it("ignores normal slugs", () => {
    expect(parseScopedModelId("deepseek-v4-flash")).toEqual({
      localModelId: "deepseek-v4-flash",
    });
  });
});

describe("humanizeModelSlug", () => {
  it("title-cases hyphenated slugs", () => {
    expect(humanizeModelSlug("deepseek-v4-flash")).toBe("Deepseek V4 Flash");
  });
});

describe("lifecycle + tenant selectable", () => {
  it("maps configured allowlisted assets to published", () => {
    expect(resolveModelAssetLifecycleStage(baseAsset())).toBe("published");
  });

  it("labels tenant selectable as 尚未接入 when backend admission is unavailable", () => {
    const asset = baseAsset({
      inRecommendationPool: true,
      tenantSelectable: false,
      admissionControlsAvailable: false,
    });
    expect(tenantSelectableLabel(asset)).toBe("尚未接入");
  });

  it("labels tenant selectable honestly when backend controls are available and not published", () => {
    const asset = baseAsset({
      inRecommendationPool: false,
      tenantSelectable: false,
      admissionControlsAvailable: true,
    });
    expect(tenantSelectableLabel(asset)).toBe("未上架");
  });
});
