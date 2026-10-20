import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_CATALOG,
  LEGACY_TEMPLATE_INTERPRETATION,
  TENANT_CAPABILITY_PACK_IDS,
} from "./catalogs.js";
import { composeBlueprintDraft } from "./compose-draft.js";
import {
  FACTORY_ADAPTER_CONTRACT,
  adapterRequestHasForbiddenKeys,
  buildAgentCreateRequest,
  buildCreationReceipt,
} from "./factory-adapter.js";
import {
  assertAdapterSkillOnly,
  assertConfirmationGate,
  assertDraftHasNoAgentId,
  assertFactoryClosedUntilConfirmed,
  assertGrowthTemplateUntouched,
  assertIdempotentInstantiate,
  assertIncompleteDraftHonest,
  assertInferenceNotResolution,
  assertNoEnterpriseData,
  assertNoInventedSkillKey,
  assertNoSecondEmployeeId,
  assertNoTaskCronLedgerOnDraft,
  assertPartialNotSuccess,
  assertReceiptNotRuntimeSource,
  assertRecipeNotTenantPack,
  assertRecipesReferenceExistingSkills,
  assertZeroSideEffectsOnAbort,
} from "./invariants.js";
import {
  DESIGNER_READ_ALLOWLIST,
  DESIGNER_READ_DENYLIST,
  emptySideEffects,
  isDesignerReadAllowed,
  isDesignerWriteForbidden,
} from "./ownership.js";
import {
  InstantiationLedger,
  abortSession,
  acceptDraft,
  beginInstantiate,
  canCallFactory,
  confirmDraft,
  finishInstantiate,
  markDraftReady,
  reviseDraft,
} from "./session.js";
import type { BlueprintDraft, CreationSession, EmployeeDesignIntent } from "./types.js";
import { DRAFT_FORBIDDEN_FIELDS } from "./types.js";

function intent(raw: string, extra: Partial<EmployeeDesignIntent> = {}): EmployeeDesignIntent {
  return {
    rawRequest: raw,
    desiredOutcomes: extra.desiredOutcomes ?? [],
    responsibilities: extra.responsibilities ?? [],
    constraints: extra.constraints ?? [],
    policyRequirements: extra.policyRequirements ?? [],
    ...extra,
  };
}

function session(status: CreationSession["status"] = "DESIGNING"): CreationSession {
  return {
    id: "cs_1",
    draftId: "d1",
    status,
    idempotencyKey: "idem-1",
    actorUserId: "user-1",
  };
}

function draftFor(raw: string, extra?: Partial<EmployeeDesignIntent>): BlueprintDraft {
  return composeBlueprintDraft({
    intent: intent(raw, extra),
    draftId: "d1",
  });
}

describe("DEC-I1 identity", () => {
  it("rejects a second employee primary key", () => {
    expect(() => assertNoSecondEmployeeId({ digitalEmployeeId: "de_1" })).toThrow(/DEC-I1/);
    expect(() => assertNoSecondEmployeeId({ agentId: "agt-1" })).not.toThrow();
  });
});

describe("DEC-I2 factory gate", () => {
  it("blocks factory before CONFIRMED", () => {
    expect(canCallFactory(session("DRAFT"))).toBe(false);
    expect(canCallFactory(session("READY_FOR_CONFIRMATION"))).toBe(false);
    expect(() => assertFactoryClosedUntilConfirmed(session("DRAFT"))).not.toThrow();
    expect(() =>
      buildAgentCreateRequest(session("READY_FOR_CONFIRMATION"), draftFor("创建销售助理")),
    ).toThrow(/CONFIRMED/);
  });
});

describe("DEC-I3 / DEC-I15 abort has zero side effects", () => {
  it("keeps the full side-effect probe empty", () => {
    const probe = emptySideEffects();
    expect(() => assertZeroSideEffectsOnAbort(probe)).not.toThrow();
    expect(() => assertZeroSideEffectsOnAbort({ ...probe, agentCreated: true })).toThrow(/DEC-I3/);
  });
});

describe("DEC-I4 / DEC-I18 adapter compile", () => {
  it("emits skill keys and blueprint version without agentId or grants", () => {
    const composed = draftFor("创建一个销售助理，负责 CRM 客户跟进和销售周报");
    let current = acceptDraft(session(), composed);
    current = markDraftReady(current, composed);
    current = confirmDraft(current);
    const request = buildAgentCreateRequest(current, composed);
    expect(request.blueprintId).toBe("sales_assistant");
    expect(request.blueprintVersion).toBe("1.0.0");
    expect(request.skillKeys).toContain("sales-coach");
    expect(adapterRequestHasForbiddenKeys(request)).toBe(false);
    expect(() => assertAdapterSkillOnly(request)).not.toThrow();
    expect(() => assertDraftHasNoAgentId(composed)).not.toThrow();
    expect(FACTORY_ADAPTER_CONTRACT.forbiddenCalls).toContain("oauth.connect");
  });
});

describe("DEC-I5 / DEC-I6 / DEC-I13 recipes and skills", () => {
  it("rejects tenant pack ids as recipes", () => {
    expect(TENANT_CAPABILITY_PACK_IDS).toContain("starter");
    expect(() => assertRecipeNotTenantPack("starter")).toThrow(/DEC-I6/);
    expect(() => assertRecipeNotTenantPack("sales-base")).not.toThrow();
  });

  it("does not invent missing skill keys", () => {
    const composed = draftFor("分析客户流失", {
      desiredOutcomes: ["skill:customer-churn-analysis-v2"],
    });
    expect(composed.unresolvedCapabilities).toContain("customer-churn-analysis-v2");
    expect(
      composed.skillRecommendations.every(
        (entry) => !entry.skillKey || DEFAULT_DESIGN_CATALOG.skillKeys.has(entry.skillKey),
      ),
    ).toBe(true);
    expect(() =>
      assertNoInventedSkillKey(composed, DEFAULT_DESIGN_CATALOG.skillKeys),
    ).not.toThrow();
    expect(() =>
      assertRecipesReferenceExistingSkills(composed, DEFAULT_DESIGN_CATALOG.skillKeys),
    ).not.toThrow();
  });

  it("lets tag-card edits replace recipe skills, modes, and policies", () => {
    const composed = draftFor("创建销售助理\n角色改为销售助理。", {
      desiredOutcomes: ["skill:sales-coach"],
      responsibilities: ["mode:customer_follow_up"],
      policyRequirements: ["policy:crm.read::recommended"],
    });
    expect(composed.roleResolution).toMatchObject({
      kind: "published",
      blueprintId: "sales_assistant",
    });
    expect(composed.skillRecommendations.map((entry) => entry.need)).toEqual(["sales-coach"]);
    expect(composed.taskPatterns.map((entry) => entry.id)).toEqual(["customer_follow_up"]);
    expect(composed.policyRecommendations).toEqual([
      { id: "crm.read", effect: "recommended", risk: "low" },
    ]);
  });
});

describe("DEC-I7 / DEC-I8 forbidden payload", () => {
  it("draft contract forbids instance and task fields", () => {
    const composed = draftFor("创建销售助理");
    expect(() => assertNoTaskCronLedgerOnDraft(composed)).not.toThrow();
    expect(() => assertNoEnterpriseData(composed)).not.toThrow();
    for (const field of DRAFT_FORBIDDEN_FIELDS) {
      expect(Object.hasOwn(composed, field)).toBe(false);
    }
  });
});

describe("DEC-I9 growth dual track + legacy mapping", () => {
  it("maps legacy templates without replacing them", () => {
    expect(LEGACY_TEMPLATE_INTERPRETATION.personal_mail_assistant).toBe("email-communication");
    expect(LEGACY_TEMPLATE_INTERPRETATION.sales_assistant).toBe("sales_assistant");
    expect(() => assertGrowthTemplateUntouched("sales_assistant", false)).not.toThrow();
    expect(() => assertGrowthTemplateUntouched("sales_assistant", true)).toThrow(/DEC-I9/);
  });
});

describe("DEC-I10 receipt is not SoT", () => {
  it("authorization does not require a receipt", () => {
    expect(() =>
      assertReceiptNotRuntimeSource({ agentId: "agt-1", allowed: true }, null),
    ).not.toThrow();
    expect(() => assertReceiptNotRuntimeSource({ agentId: "agt-1", allowed: false }, null)).toThrow(
      /DEC-I10/,
    );
  });
});

describe("DEC-I11 incomplete finance draft", () => {
  it("asks critical questions instead of inventing finance write", () => {
    const composed = draftFor("我要一个财务助理");
    expect(composed.missingCriticalInputs.length).toBeGreaterThan(0);
    expect(composed.validation.status).toBe("valid_with_gaps");
    expect(
      composed.policyRecommendations.find((entry) => entry.id === "finance.write")?.effect,
    ).toBe("disabled");
    expect(() => assertIncompleteDraftHonest(composed)).not.toThrow();
    expect(() => assertConfirmationGate(composed, true)).not.toThrow();
  });
});

describe("DEC-I12 inference vs resolution", () => {
  it("keeps hypothesis and registry fact on separate fields", () => {
    const named = draftFor("创建销售助理");
    expect(named.roleHypothesis.role).toBe("sales_assistant");
    expect(named.roleResolution.kind).toBe("published");
    if (named.roleResolution.kind === "published") {
      expect(named.roleResolution.blueprintId).toBe("sales_assistant");
    }
    expect(() => assertInferenceNotResolution(named)).not.toThrow();

    const unnamed = draftFor("每天帮我看销售数据，发现异常提醒我，每周一给我一个总结");
    expect(unnamed.roleResolution.kind).toBe("published");
    if (unnamed.roleResolution.kind === "published") {
      expect(unnamed.roleResolution.blueprintId).toBe("sales_operations_analyst");
    }
  });
});

describe("DEC-I14 / DEC-I16 / DEC-I17 session", () => {
  it("double confirm instantiates one agent and can be PARTIAL", () => {
    const composed = draftFor("创建销售助理");
    let current = acceptDraft(session(), composed);
    current = markDraftReady(current, composed);
    current = confirmDraft(current);
    current = beginInstantiate(current);
    const ledger = new InstantiationLedger();
    const first = ledger.remember(current.idempotencyKey, "agt-a");
    const second = ledger.remember(current.idempotencyKey, "agt-b");
    expect(() => assertIdempotentInstantiate(first, second)).not.toThrow();
    current = finishInstantiate(current, { agentId: first, failedSkillCount: 1 });
    expect(current.status).toBe("PARTIAL");
    expect(() => assertPartialNotSuccess(current, 1)).not.toThrow();
  });

  it("revision stays on the same session", () => {
    const first = draftFor("创建销售助理");
    let current = acceptDraft(session(), first);
    const revised = draftFor("创建销售助理", { policyRequirements: ["CRM 只读，不能改"] });
    const next = reviseDraft(current, revised);
    expect(next.session.id).toBe("cs_1");
    expect(next.draft.revision).toBe(2);
    expect(next.draft.policyRecommendations.find((entry) => entry.id === "crm.write")?.effect).toBe(
      "disabled",
    );
  });
});

describe("DEC-I15 designer data plane", () => {
  it("allows product catalogs and denies enterprise data", () => {
    expect(isDesignerReadAllowed("skill_registry")).toBe(true);
    expect(DESIGNER_READ_ALLOWLIST).toContain("blueprint_registry");
    expect(DESIGNER_READ_DENYLIST).toContain("crm_customer_data");
    expect(isDesignerReadAllowed("crm_customer_data")).toBe(false);
    expect(isDesignerWriteForbidden("agents.create")).toBe(true);
  });
});

describe("case C composite market draft", () => {
  it("resolves competitor monitoring without inventing skills", () => {
    const composed = draftFor("监控竞品价格、分析内容、每周报告");
    expect(composed.roleResolution.kind).toBe("published");
    if (composed.roleResolution.kind === "published") {
      expect(composed.roleResolution.blueprintId).toBe("market_analyst");
    }
    expect(composed.roleRecipeIds).toContain("market-research");
    expect(
      composed.skillRecommendations.every(
        (entry) => !entry.skillKey || DEFAULT_DESIGN_CATALOG.skillKeys.has(entry.skillKey),
      ),
    ).toBe(true);
  });
});

describe("case D CRM read-only from raw request", () => {
  it("disables crm.write without granting write", () => {
    const composed = draftFor("能看 CRM，不能改 CRM");
    expect(composed.policyRecommendations.find((entry) => entry.id === "crm.write")?.effect).toBe(
      "disabled",
    );
    expect(
      composed.policyRecommendations.some(
        (entry) => entry.id === "crm.write" && entry.effect === "recommended",
      ),
    ).toBe(false);
  });
});

describe("case E high-risk publish", () => {
  it("keeps public publish as confirmation_required", () => {
    const composed = draftFor("创建一个营销员工，可以直接发布公众号文章", {
      policyRequirements: ["可以直接发布公众号"],
    });
    const publish = composed.policyRecommendations.find((entry) => entry.id === "public.publish");
    expect(publish?.effect).toBe("confirmation_required");
    expect(composed.riskFlags.some((flag) => flag.id === "public.publish")).toBe(true);
  });
});

describe("case G receipt version fields", () => {
  it("records blueprintVersion and has no upgrade API", () => {
    const composed = draftFor("创建销售助理");
    let current = acceptDraft(session(), composed);
    current = markDraftReady(current, composed);
    current = confirmDraft(current);
    current = beginInstantiate(current);
    current = finishInstantiate(current, { agentId: "agt-g", failedSkillCount: 0 });
    const receipt = buildCreationReceipt({
      session: current,
      draft: composed,
      agentId: "agt-g",
      skillInstall: {
        requested: ["sales-coach"],
        succeeded: ["sales-coach"],
        failed: [],
      },
      confirmedAt: "2026-09-17T00:00:00.000Z",
    });
    expect(receipt.blueprintId).toBe("sales_assistant");
    expect(receipt.blueprintVersion).toBe("1.0.0");
    expect(receipt.creationSessionId).toBe("cs_1");
    expect("upgrade" in FACTORY_ADAPTER_CONTRACT).toBe(false);
  });
});

describe("case H email recipe reuse", () => {
  it("lets multiple roles reference the same mail skillKey", () => {
    const salesMail = draftFor("创建销售助理，还要处理邮件");
    const officeMail = draftFor("办公助理，帮我处理邮箱");
    expect(salesMail.roleRecipeIds).toContain("email-communication");
    expect(officeMail.roleRecipeIds).toContain("email-communication");
    expect(
      salesMail.skillRecommendations.some((entry) => entry.skillKey === "personal-mail-assistant"),
    ).toBe(true);
    expect(
      officeMail.skillRecommendations.some((entry) => entry.skillKey === "personal-mail-assistant"),
    ).toBe(true);
  });
});

describe("case M abort before factory", () => {
  it("fails the session without side effects", () => {
    const current = abortSession(session("DRAFT"));
    expect(current.status).toBe("FAILED");
    expect(() => abortSession(session("INSTANTIATED"))).toThrow(/cannot abort/);
    expect(() => assertZeroSideEffectsOnAbort(emptySideEffects())).not.toThrow();
  });
});

describe("three entries share one draft contract", () => {
  it("keeps ai / role chip / enterprise template on the same fields", () => {
    const ai = composeBlueprintDraft({
      intent: intent("创建销售助理"),
      draftId: "d-ai",
      source: "ai",
    });
    const chip = composeBlueprintDraft({
      intent: intent("创建销售助理"),
      draftId: "d-chip",
      source: "role_chip",
    });
    const template = composeBlueprintDraft({
      intent: intent("创建销售助理"),
      draftId: "d-tpl",
      source: "enterprise_template",
    });
    expect(ai.roleResolution).toEqual(chip.roleResolution);
    expect(chip.roleResolution).toEqual(template.roleResolution);
    expect(ai.source).toBe("ai");
    expect(chip.source).toBe("role_chip");
    expect(template.source).toBe("enterprise_template");
  });
});

describe("invalid draft cannot enter confirmation", () => {
  it("blocks READY_FOR_CONFIRMATION", () => {
    const composed = draftFor("创建销售助理");
    const invalid = {
      ...composed,
      validation: {
        status: "invalid" as const,
        checks: [{ id: "role_legal", ok: false, detail: "broken" }],
      },
    };
    expect(() => markDraftReady(session("DRAFT"), invalid)).toThrow(/invalid draft/);
    expect(() => assertConfirmationGate(invalid, true)).toThrow(/DEC-I16/);
  });
});
