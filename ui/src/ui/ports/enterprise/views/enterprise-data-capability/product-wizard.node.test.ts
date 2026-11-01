import { describe, expect, it } from "vitest";
import {
  actionRefToken,
  applySourceToggle,
  clampProductWizardStep,
  filterActionsForConnectorIds,
  formatSourceActionMismatchMessage,
  PRODUCT_WIZARD_NO_ALIGNED_ACTIONS_MESSAGE,
  productWizardValidationContext,
  validateProductWizardStep,
  wizardActionsForSelection,
} from "./product-wizard.ts";

describe("product-wizard", () => {
  const draft = {
    capabilityKey: "crm_sync",
    displayName: "客户同步",
    description: "",
    sourceIds: new Set(["s1"]),
    actionRefTokens: new Set(["c:a:1"]),
    outputMode: "direct" as const,
    projectionTemplateKey: "",
    openScopeReady: false,
  };

  it("validates step dependencies and missing jumps", () => {
    expect(
      validateProductWizardStep(2, draft, { sourceCount: 0, actionCount: 0, seatCount: 1 }),
    ).toMatchObject({ ok: false, missing: ["sources", "actions"] });
    expect(
      validateProductWizardStep(2, draft, { sourceCount: 1, actionCount: 1, seatCount: 1 }),
    ).toMatchObject({ ok: true });
    expect(
      validateProductWizardStep(4, draft, { sourceCount: 1, actionCount: 1, seatCount: 0 }),
    ).toMatchObject({ ok: false, missing: ["seats"] });
    expect(
      validateProductWizardStep(4, draft, { sourceCount: 1, actionCount: 1, seatCount: 1 }),
    ).toMatchObject({ ok: false, message: "请至少选择一个岗位或部门作为开放范围。" });
    expect(
      validateProductWizardStep(
        4,
        { ...draft, openScopeReady: true },
        { sourceCount: 1, actionCount: 1, seatCount: 1 },
      ),
    ).toMatchObject({ ok: true });
  });

  it("names the projection output mode as knowledge-universe supply", () => {
    expect(
      validateProductWizardStep(
        3,
        { ...draft, outputMode: "projection", projectionTemplateKey: "" },
        { sourceCount: 1, actionCount: 1, seatCount: 1 },
      ),
    ).toMatchObject({
      ok: false,
      message: "请选择投影模板。若只登记能力、不供给知识宇宙，请改用「仅登记能力」。",
    });
    expect(
      validateProductWizardStep(
        3,
        { ...draft, outputMode: "direct", projectionTemplateKey: "" },
        { sourceCount: 1, actionCount: 1, seatCount: 1 },
      ),
    ).toMatchObject({ ok: true });
  });

  it("clamps wizard steps", () => {
    expect(clampProductWizardStep(0)).toBe(1);
    expect(clampProductWizardStep(9)).toBe(4);
  });
});

const sources = [
  { sourceId: "sf", connectorId: "crm-salesforce" },
  { sourceId: "yy", connectorId: "erp-yonyou-tplus" },
];

const crmAction = {
  connectorId: "crm-salesforce",
  actionKey: "crm.customer.export",
  version: "v1",
  displayName: "客户导出",
};

const yonyouAction = {
  connectorId: "erp-yonyou-tplus",
  actionKey: "erp.voucher.list",
  version: "v1",
  displayName: "凭证列表",
};

const actions = [crmAction, yonyouAction];
const crmToken = actionRefToken(crmAction);
const yonyouToken = actionRefToken(yonyouAction);

function alignedDraft(patch?: {
  sourceIds?: ReadonlySet<string>;
  actionRefTokens?: ReadonlySet<string>;
}) {
  return {
    capabilityKey: "crm_sync",
    displayName: "客户同步",
    description: "",
    sourceIds: patch?.sourceIds ?? new Set(["yy"]),
    actionRefTokens: patch?.actionRefTokens ?? new Set([yonyouToken]),
    outputMode: "direct" as const,
    projectionTemplateKey: "",
    openScopeReady: false,
  };
}

describe("product wizard source/action alignment", () => {
  const ctx = productWizardValidationContext({
    sources,
    actions,
    seatCount: 1,
  });

  it("rejects an action whose connectorId is outside the selected sources", () => {
    const result = validateProductWizardStep(
      2,
      alignedDraft({
        sourceIds: new Set(["yy"]),
        actionRefTokens: new Set([crmToken]),
      }),
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toBe(formatSourceActionMismatchMessage(["客户导出"]));
  });

  it("accepts an action that shares a selected source connectorId", () => {
    expect(validateProductWizardStep(2, alignedDraft(), ctx)).toMatchObject({ ok: true });
    expect(
      validateProductWizardStep(
        2,
        alignedDraft({
          sourceIds: new Set(["sf", "yy"]),
          actionRefTokens: new Set([crmToken]),
        }),
        ctx,
      ),
    ).toMatchObject({ ok: true });
  });

  it("explains when the selected source has no actions on its connector", () => {
    const result = validateProductWizardStep(
      2,
      alignedDraft({
        sourceIds: new Set(["yy"]),
        actionRefTokens: new Set(),
      }),
      productWizardValidationContext({
        sources,
        actions: [crmAction],
        seatCount: 1,
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      message: PRODUCT_WIZARD_NO_ALIGNED_ACTIONS_MESSAGE,
      missing: ["actions"],
    });
  });

  it("filters the action list to linked connectorIds and keeps a stale selection visible", () => {
    expect(filterActionsForConnectorIds(actions, new Set(["erp-yonyou-tplus"]))).toEqual([
      actions[1],
    ]);
    expect(filterActionsForConnectorIds(actions, new Set())).toEqual([]);
    expect(
      wizardActionsForSelection(actions, new Set(["erp-yonyou-tplus"]), new Set([crmToken])),
    ).toEqual(actions);
    expect(wizardActionsForSelection(actions, new Set(), new Set())).toEqual([]);
  });

  it("clears incompatible actions when the source selection changes", () => {
    const switched = applySourceToggle({
      sourceIds: new Set(["sf"]),
      actionRefTokens: new Set([crmToken]),
      toggledSourceId: "yy",
      sources,
    });
    expect(switched.pruned).toBe(false);
    expect(switched.sourceIds).toEqual(new Set(["sf", "yy"]));
    expect(switched.actionRefTokens).toEqual(new Set([crmToken]));

    const removed = applySourceToggle({
      sourceIds: switched.sourceIds,
      actionRefTokens: switched.actionRefTokens,
      toggledSourceId: "sf",
      sources,
    });
    expect(removed.pruned).toBe(true);
    expect(removed.sourceIds).toEqual(new Set(["yy"]));
    expect(removed.actionRefTokens).toEqual(new Set());
  });
});
