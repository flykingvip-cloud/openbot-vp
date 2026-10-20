import { describe, expect, it } from "vitest";
import { emptyWorkbenchAgentDesignState } from "./workbench-design-card.ts";
import {
  DESIGN_ROLE_FAMILIES,
  addDesignTag,
  buildRevisionFromTagDraft,
  commitCustomDesignTag,
  findDesignFamily,
  removeDesignTag,
  rolesInFamily,
  selectDesignFamily,
  tagDraftFromMapping,
} from "./workbench-design-catalog.ts";
import {
  labelForRole,
  labelForSkill,
  resolveAgentCreatorStep,
  splitQuestionOptions,
  suggestAgentEmojiFromDesign,
  suggestAgentNameFromDesign,
} from "./workbench-design-labels.ts";

describe("workbench design card state", () => {
  it("starts unconfirmed with no mapping", () => {
    const state = emptyWorkbenchAgentDesignState();
    expect(state.confirmed).toBe(false);
    expect(state.mapping).toBeNull();
    expect(state.sessionId).toBeNull();
    expect(state.tagDraft).toBeNull();
  });
});

describe("workbench design labels", () => {
  it("localizes published role and skill keys", () => {
    expect(labelForRole("sales_assistant")).toBe("销售助理");
    expect(labelForSkill("sales-coach")).toBe("销售辅导");
    expect(labelForSkill("summarize")).toBe("摘要整理");
  });

  it("derives wizard step from design progress", () => {
    const design = emptyWorkbenchAgentDesignState();
    expect(resolveAgentCreatorStep({ design, roleSource: "ai" })).toBe("intent");
    design.mapping = {
      headline: "我理解的是…",
      requestItems: [],
      role: { display: "销售助理", resolutionKind: "published", evidence: [] },
      capabilities: [],
      workMode: { taskPatterns: [] },
      safetyBoundary: [],
      gaps: { questions: [], missing: [], unresolved: [] },
    };
    expect(resolveAgentCreatorStep({ design, roleSource: "ai" })).toBe("review");
    design.confirmed = true;
    expect(resolveAgentCreatorStep({ design, roleSource: "ai" })).toBe("identity");
  });

  it("prefills a Chinese name and emoji from the design mapping", () => {
    const design = emptyWorkbenchAgentDesignState();
    design.mapping = {
      headline: "我理解的是…",
      requestItems: [],
      role: {
        display: "sales_assistant",
        resolutionKind: "published",
        blueprintId: "sales_assistant",
        evidence: [],
      },
      capabilities: [],
      workMode: { taskPatterns: [] },
      safetyBoundary: [],
      gaps: { questions: [], missing: [], unresolved: [] },
    };
    expect(suggestAgentNameFromDesign(design.mapping, "销售助理", [])).toBe("销售助理");
    expect(suggestAgentEmojiFromDesign(design.mapping)).toBe("💼");
  });

  it("splits blocking questions into short chips", () => {
    expect(splitQuestionOptions("主要负责对账、费用审核、奖金核算，还是财务分析？")).toEqual([
      "对账",
      "费用审核",
      "奖金核算",
      "财务分析",
    ]);
  });
});

describe("workbench design catalog", () => {
  it("groups published and unpublished roles under the layered family list", () => {
    expect(DESIGN_ROLE_FAMILIES.map((family) => family.id)).toEqual([
      "general_office",
      "sales_customer",
      "legal_risk",
      "finance_ops",
      "marketing_growth",
      "hr",
      "customer_service",
      "tech_operations",
    ]);
    expect(rolesInFamily("sales_customer").map((role) => role.label)).toEqual([
      "销售助理",
      "销售运营分析师",
    ]);
    expect(findDesignFamily("contract_legal")?.id).toBe("legal_risk");
    expect(findDesignFamily("content_marketing")?.id).toBe("marketing_growth");
  });

  it("auto-matches tag cards from a compiled mapping and can delete or add in-category tags", () => {
    const mapping = {
      headline: "我理解的是…",
      requestItems: [],
      role: {
        display: "销售助理",
        resolutionKind: "published",
        blueprintId: "sales_assistant",
        evidence: [],
      },
      capabilities: [
        { need: "sales-coach", status: "resolved", skillKey: "sales-coach" },
        { need: "summarize", status: "resolved", skillKey: "summarize" },
      ],
      workMode: { taskPatterns: ["客户跟进", "销售周报"] },
      safetyBoundary: [{ id: "crm.write", effect: "disabled", risk: "high" }],
      gaps: { questions: [], missing: [], unresolved: [] },
    };
    const draft = tagDraftFromMapping(mapping);
    expect(draft.familyId).toBe("sales_customer");
    expect(draft.roleId).toBe("sales_assistant");
    expect(draft.capabilities).toEqual(["sales-coach", "summarize"]);
    expect(draft.workModes).toEqual(["customer_follow_up", "weekly_sales_report"]);
    expect(draft.permissions).toContain("crm.write::disabled");

    const removed = removeDesignTag(draft, "capability", "summarize");
    expect(removed.capabilities).toEqual(["sales-coach"]);
    const added = addDesignTag(removed, "capability", "personal-mail-assistant");
    expect(added.capabilities).toContain("personal-mail-assistant");

    const custom = commitCustomDesignTag({
      ...added,
      addingCategory: "workMode",
      addingText: "每日巡检",
    });
    expect(custom.workModes.some((id) => id.startsWith("custom:"))).toBe(true);
    expect(custom.customTags.some((tag) => tag.label === "每日巡检")).toBe(true);

    const revision = buildRevisionFromTagDraft({
      ...emptyWorkbenchAgentDesignState(),
      mapping,
      tagDraft: custom,
    });
    expect(revision).toContain("tag.skill:sales-coach");
    expect(revision).not.toContain("tag.skill:summarize");
    expect(revision).toContain("tag.mode:custom:workMode:每日巡检");
  });

  it("rematches capability tags when the user picks another family/role", () => {
    const draft = selectDesignFamily(tagDraftFromMapping(null), "legal_risk");
    expect(draft.familyId).toBe("legal_risk");
    expect(draft.roleId).toBe("contract_reviewer");
    expect(draft.capabilities).toContain("nano-pdf");
    expect(draft.workModes).toEqual(["contract_review"]);
  });
});
