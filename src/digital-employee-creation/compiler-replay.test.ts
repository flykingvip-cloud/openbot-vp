import { describe, expect, it } from "vitest";
import { DEC_P2_OFFLINE_ADMISSION, compileEmployeeDesign } from "./compile.js";
import { mappingHasForbiddenNarrative, projectDesignMapping } from "./confirmation-mapping.js";
import { extractDesignIntent } from "./extract-intent.js";
import { COMPILER_FIXTURES } from "./fixtures.js";
import { emptySideEffects, hasAnySideEffect } from "./ownership.js";
import { replayAllCompilerFixtures } from "./replay.js";

describe("P2-OFFLINE admission", () => {
  it("does not authorize production designer or factory; LLM is now enabled", () => {
    expect(DEC_P2_OFFLINE_ADMISSION.productionDesigner).toBe(false);
    expect(DEC_P2_OFFLINE_ADMISSION.llm).toBe(true);
    expect(DEC_P2_OFFLINE_ADMISSION.factoryCall).toBe(false);
  });
});

describe("D1 extractDesignIntent", () => {
  it("pulls schedule, delivery, and read-only policy from the raw sentence", () => {
    const intent = extractDesignIntent("每天帮我看销售数据，每周一给我一个总结，CRM 只读");
    expect(intent.schedule).toBe("每天");
    expect(intent.delivery).toBe("总结");
    expect(intent.policyRequirements.some((item) => /只读/.test(item))).toBe(true);
  });

  it("parses structured tag-card revision tokens", () => {
    const intent = extractDesignIntent(
      [
        "角色改为财务助理。",
        "tag.skill:summarize",
        "tag.mode:finance_review",
        "tag.policy:finance.write::disabled",
      ].join("\n"),
    );
    expect(intent.desiredOutcomes).toContain("skill:summarize");
    expect(intent.responsibilities).toContain("mode:finance_review");
    expect(intent.policyRequirements).toContain("policy:finance.write::disabled");
  });
});

describe("confirmation mapping", () => {
  it("projects design facts without CoT", () => {
    const { intent, draft } = compileEmployeeDesign({
      rawRequest: "创建销售助理，跟进 CRM，出销售周报",
      draftId: "map-1",
    });
    const card = projectDesignMapping(intent, draft);
    expect(card.headline).toBe("我理解的是…");
    expect(card.role.blueprintId).toBe("sales_assistant");
    expect(card.role.display).toBe("销售助理");
    expect(card.requestItems.some((item) => item.label === "原文")).toBe(true);
    expect(mappingHasForbiddenNarrative(card)).toBe(false);
  });
});

describe("compiler fixture replay A–N", () => {
  it("covers every requirements case and stays side-effect free", () => {
    expect(COMPILER_FIXTURES.map((item) => item.id).join("")).toBe("ABCDEFGHIJKLMN");
    const results = replayAllCompilerFixtures();
    const failures = results.flatMap((item) => item.failures);
    expect(failures).toEqual([]);
    expect(hasAnySideEffect(emptySideEffects())).toBe(false);
  });
});
