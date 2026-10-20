import { describe, expect, it } from "vitest";
import {
  createFieldMeta,
  detectUserEditedProfileFields,
  mergeSkillProfileWithFieldMeta,
  shouldApplyProfileFieldPatch,
} from "./skill-profile-field-meta.ts";

describe("skill-profile-field-meta", () => {
  it("never overwrites user-sourced fields", () => {
    expect(
      shouldApplyProfileFieldPatch({
        currentMeta: createFieldMeta("user", 1),
        nextMeta: createFieldMeta("inferred", 0.99),
        field: "category",
        currentValue: "客户服务",
      }),
    ).toBe(false);
  });

  it("allows higher-confidence inferred values to replace weaker inferred values", () => {
    expect(
      shouldApplyProfileFieldPatch({
        currentMeta: createFieldMeta("inferred", 0.6),
        nextMeta: createFieldMeta("inferred", 0.92),
        field: "category",
        currentValue: "旧分类",
      }),
    ).toBe(true);
  });

  it("merges inferred patch into empty profile fields", () => {
    const merged = mergeSkillProfileWithFieldMeta({
      profile: {
        name: "",
        summary: "",
        assetType: "capability",
        usageExamples: [],
        inputDescription: "",
        outputDescription: "",
        tags: [],
        category: "",
      },
      patch: {
        category: "会议协作",
        tags: ["会议"],
      },
      patchMeta: "inferred",
      patchConfidence: 0.84,
    });
    expect(merged.profile.category).toBe("会议协作");
    expect(merged.profile.tags).toEqual(["会议"]);
    expect(merged.fieldMeta.category?.source).toBe("inferred");
  });

  it("keeps user category when inferred patch arrives later", () => {
    const merged = mergeSkillProfileWithFieldMeta({
      profile: {
        name: "会议邀请函",
        summary: "模版",
        assetType: "template",
        usageExamples: [],
        inputDescription: "",
        outputDescription: "",
        tags: [],
        category: "用户分类",
      },
      fieldMeta: {
        category: createFieldMeta("user", 1),
      },
      patch: {
        category: "会议协作",
      },
      patchMeta: "inferred",
      patchConfidence: 0.95,
    });
    expect(merged.profile.category).toBe("用户分类");
  });

  it("detects manually edited profile fields", () => {
    const fields = detectUserEditedProfileFields(
      {
        name: "会议邀请函",
        summary: "模版",
        assetType: "template",
        usageExamples: ["周会"],
        inputDescription: "会议信息",
        outputDescription: "正文",
        tags: ["会议"],
        category: "协作",
      },
      {
        category: "会议协作",
        tags: ["会议", "模版"],
      },
    );
    expect(fields.toSorted()).toEqual(["category", "tags"]);
  });
});
