/**
 * 数据产品新建四步向导 — 步骤定义与校验（纯函数）。
 */

export type ProductWizardStep = 1 | 2 | 3 | 4;

export const PRODUCT_WIZARD_STEPS: ReadonlyArray<{ step: ProductWizardStep; title: string }> = [
  { step: 1, title: "业务定义" },
  { step: 2, title: "数据输入" },
  { step: 3, title: "输出定义" },
  { step: 4, title: "开放范围" },
];

export type ProductWizardDraft = {
  capabilityKey: string;
  displayName: string;
  description: string;
  sourceIds: ReadonlySet<string>;
  actionRefTokens: ReadonlySet<string>;
  outputMode: "direct" | "projection";
  projectionTemplateKey: string;
  openScopeReady: boolean;
};

export type ProductWizardValidation = {
  ok: boolean;
  message: string | null;
  /** 缺失依赖时的跳转建议。 */
  missing: Array<"sources" | "actions" | "seats">;
};

export function validateProductWizardStep(
  step: ProductWizardStep,
  draft: ProductWizardDraft,
  ctx: { sourceCount: number; actionCount: number; seatCount: number },
): ProductWizardValidation {
  if (step === 1) {
    if (!draft.displayName.trim() || !draft.capabilityKey.trim()) {
      return { ok: false, message: "请填写产品名称与标识。", missing: [] };
    }
    return { ok: true, message: null, missing: [] };
  }
  if (step === 2) {
    const missing: Array<"sources" | "actions" | "seats"> = [];
    if (ctx.sourceCount === 0) {
      missing.push("sources");
    }
    if (ctx.actionCount === 0) {
      missing.push("actions");
    }
    if (missing.length > 0) {
      return {
        ok: false,
        message: "缺少可用数据源或连接器动作，请先完成数据资产接入。",
        missing,
      };
    }
    if (draft.sourceIds.size === 0 || draft.actionRefTokens.size === 0) {
      return { ok: false, message: "请至少选择一个数据源和一个动作。", missing: [] };
    }
    return { ok: true, message: null, missing: [] };
  }
  if (step === 3) {
    if (draft.outputMode === "projection" && !draft.projectionTemplateKey.trim()) {
      return {
        ok: false,
        message: "请选择投影模板。若只登记能力、不供给知识宇宙，请改用「仅登记能力」。",
        missing: [],
      };
    }
    return { ok: true, message: null, missing: [] };
  }
  // step 4
  if (ctx.seatCount === 0) {
    return {
      ok: false,
      message: "当前租户暂无岗位，开放范围无法生效。请先在组织中创建岗位。",
      missing: ["seats"],
    };
  }
  if (!draft.openScopeReady) {
    return {
      ok: false,
      message: "请至少选择一个岗位或部门作为开放范围。",
      missing: [],
    };
  }
  return { ok: true, message: null, missing: [] };
}

export function clampProductWizardStep(step: number): ProductWizardStep {
  if (step <= 1) {
    return 1;
  }
  if (step >= 4) {
    return 4;
  }
  return step as ProductWizardStep;
}
