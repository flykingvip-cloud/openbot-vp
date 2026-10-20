import { beforeEach, describe, expect, it } from "vitest";
import {
  adoptionFromShareVisibility,
  clearAdoptionStorageForTests,
  mergeAdoptionEvidence,
} from "./adoption-sync.ts";
import {
  applyAutofillHintsToForm,
  applyAutofillSuggestionToCapabilityPatch,
  buildAutofillHintText,
  FOLDED_TECHNICAL_SUMMARY_HINT,
  looksLikeTechnicalDiagnosticSummary,
  presentEmployeeFacingSummary,
} from "./incubation-autofill.ts";
import { deriveIncubationDecision } from "./scorer.ts";

describe("adoption-sync", () => {
  beforeEach(() => {
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
    clearAdoptionStorageForTests();
  });

  it("maps enterprise share visibility to adoption evidence", () => {
    const adoption = adoptionFromShareVisibility("已进入企业资产库");
    expect(adoption.enterpriseSubmitted).toBe(true);
  });

  it("promotes to L4 when L3 evidence meets adoption", () => {
    const adoption = adoptionFromShareVisibility("已共享到协作小组");
    const decision = deriveIncubationDecision({
      evidence: {
        recurrenceCount: 3,
        adoption,
      },
      source: "session-detector",
    });
    expect(decision.level).toBe("L4");
  });

  it("merges adoption layers with OR semantics", () => {
    const merged = mergeAdoptionEvidence(
      {
        distinctMemberCount: 1,
        sharedToGroup: false,
        adminRecommended: false,
        enterpriseSubmitted: false,
      },
      {
        distinctMemberCount: 3,
        sharedToGroup: true,
        adminRecommended: false,
        enterpriseSubmitted: false,
      },
    );
    expect(merged.distinctMemberCount).toBe(3);
    expect(merged.sharedToGroup).toBe(true);
  });
});

describe("incubation-autofill", () => {
  it("builds readable autofill hint text", () => {
    const hint = buildAutofillHintText({
      category: "流程",
      tags: ["周报", "模板"],
      summaryRefinement: "自动生成周报模板",
    });
    expect(hint).toContain("分类：流程");
    expect(hint).toContain("标签：周报、模板");
  });

  it("applies autofill hints without overwriting existing summary", () => {
    const next = applyAutofillHintsToForm(
      { name: "周报", summary: "已有摘要", assetType: "capability" },
      { category: "流程", summaryRefinement: "优化摘要" },
    );
    expect(next.summary).toBe("已有摘要");
    expect(next.assetType).toBe("workflow");
  });

  it("replaces technical diagnostic summaries and fills empty fields", () => {
    expect(
      looksLikeTechnicalDiagnosticSummary(
        "信封注册为 skill_abc；ASSET.md 指向 skill-template，索引失败",
      ),
    ).toBe(true);
    const patch = applyAutofillSuggestionToCapabilityPatch(
      {
        summary: "ASSET.md 指向 skill-template，索引失败",
        category: "",
        tags: [],
        inputDescription: "",
        outputDescription: "已有输出",
        usageExamples: [],
      },
      {
        summaryRefinement: "公众号内容生产与发布标准套件",
        category: "内容运营",
        tags: ["公众号", "发布"],
        inputDescription: "选题与素材",
        outputDescription: "应保留已有输出",
        usageExamples: ["写一篇产品稿并发布"],
      },
    );
    expect(patch).toMatchObject({
      summary: "公众号内容生产与发布标准套件",
      category: "内容运营",
      tags: ["公众号", "发布"],
      inputDescription: "选题与素材",
      usageExamples: ["写一篇产品稿并发布"],
    });
    expect(patch.outputDescription).toBeUndefined();
  });

  it("folds technical diagnostics into an employee-facing hint", () => {
    expect(presentEmployeeFacingSummary("ASSET.md 指向 skill-template，索引失败")).toBe(
      FOLDED_TECHNICAL_SUMMARY_HINT,
    );
    expect(presentEmployeeFacingSummary("分析客户情绪")).toBe("分析客户情绪");
    expect(presentEmployeeFacingSummary("")).toBe("暂无一句话说明");
  });
});
