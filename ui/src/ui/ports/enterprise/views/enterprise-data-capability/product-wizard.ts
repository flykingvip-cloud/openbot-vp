/**
 * 数据产品新建四步向导 — 步骤定义与校验（纯函数）。
 *
 * 动作的 connectorId 必须落在已选数据源的 connectorId 集合内，与服务端
 * `assertCapabilitySourceActionAlignment`（DATA_CAPABILITY_SOURCE_ACTION_MISMATCH）一致。
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

export type ProductWizardSourceRef = {
  sourceId: string;
  connectorId: string;
};

export type ProductWizardActionRef = {
  connectorId: string;
  actionKey: string;
  version: string;
  displayName?: string;
};

export type ProductWizardValidationContext = {
  sourceCount: number;
  actionCount: number;
  seatCount: number;
  /** 传入后，第 2 步会校验动作 connectorId 是否落在已选数据源上。 */
  sources?: ReadonlyArray<ProductWizardSourceRef>;
  actions?: ReadonlyArray<ProductWizardActionRef>;
};

export type ProductWizardValidation = {
  ok: boolean;
  message: string | null;
  /** 缺失依赖时的跳转建议。 */
  missing: Array<"sources" | "actions" | "seats">;
};

export const PRODUCT_WIZARD_SOURCE_ACTION_MISMATCH_MESSAGE =
  "所选动作与已关联数据源的连接器不一致。请返回「数据输入」，只保留同一连接器下的动作。";

export const PRODUCT_WIZARD_SOURCE_ACTION_PRUNED_MESSAGE =
  "已取消与当前数据源连接器不一致的动作，请重新选择动作。";

export const PRODUCT_WIZARD_NO_ALIGNED_ACTIONS_MESSAGE =
  "所选数据源下没有可用动作。请更换数据源，或先在数据资产中接入该连接器的动作。";

export function formatSourceActionMismatchMessage(actionLabels: readonly string[]): string {
  const unique = [
    ...new Set(actionLabels.map((label) => label.trim()).filter((label) => label.length > 0)),
  ];
  if (unique.length === 0) {
    return PRODUCT_WIZARD_SOURCE_ACTION_MISMATCH_MESSAGE;
  }
  return `所选动作（${unique.join("、")}）与已关联数据源的连接器不一致。请返回「数据输入」，只保留同一连接器下的动作。`;
}

export function actionRefToken(action: ProductWizardActionRef): string {
  return `${action.connectorId}:${action.actionKey}:${action.version}`;
}

/** 动作 token 形如 `connectorId:actionKey:version`，连接器取第一段。 */
export function connectorIdFromActionToken(token: string): string {
  const separator = token.indexOf(":");
  if (separator <= 0) {
    return "";
  }
  return token.slice(0, separator).trim();
}

export function actionLabelFromToken(token: string): string {
  const connectorId = connectorIdFromActionToken(token);
  if (!connectorId) {
    return "";
  }
  const rest = token.slice(connectorId.length + 1);
  const versionSep = rest.lastIndexOf(":");
  if (versionSep <= 0) {
    return "";
  }
  const actionKey = rest.slice(0, versionSep).trim();
  const version = rest.slice(versionSep + 1).trim();
  if (!actionKey || !version) {
    return "";
  }
  return `${actionKey}@${version}`;
}

export function connectorIdsForSelectedSources(
  sources: ReadonlyArray<ProductWizardSourceRef>,
  sourceIds: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  for (const source of sources) {
    if (!sourceIds.has(source.sourceId)) {
      continue;
    }
    const connectorId = source.connectorId.trim();
    if (connectorId) {
      ids.add(connectorId);
    }
  }
  return ids;
}

export function filterActionsForConnectorIds<T extends { connectorId: string }>(
  actions: ReadonlyArray<T>,
  connectorIds: ReadonlySet<string>,
): T[] {
  if (connectorIds.size === 0) {
    return [];
  }
  return actions.filter((action) => connectorIds.has(action.connectorId.trim()));
}

/**
 * 已选数据源下的动作，外加仍被勾选、但已与数据源不一致的动作（便于取消勾选）。
 * 未选数据源时不提供动作，避免先勾上其他连接器的动作。
 */
export function wizardActionsForSelection<T extends ProductWizardActionRef>(
  actions: ReadonlyArray<T>,
  connectorIds: ReadonlySet<string>,
  selectedTokens: ReadonlySet<string>,
): T[] {
  return actions.filter((action) => {
    const aligned = connectorIds.size > 0 && connectorIds.has(action.connectorId.trim());
    if (aligned) {
      return true;
    }
    return selectedTokens.has(actionRefToken(action));
  });
}

export function misalignedActionTokens(
  tokens: ReadonlySet<string>,
  connectorIds: ReadonlySet<string>,
): string[] {
  const mismatched: string[] = [];
  for (const token of tokens) {
    const connectorId = connectorIdFromActionToken(token);
    if (!connectorId || !connectorIds.has(connectorId)) {
      mismatched.push(token);
    }
  }
  return mismatched;
}

export function reconcileActionTokens(
  tokens: ReadonlySet<string>,
  connectorIds: ReadonlySet<string>,
): { tokens: Set<string>; pruned: boolean } {
  const next = new Set<string>();
  for (const token of tokens) {
    const connectorId = connectorIdFromActionToken(token);
    if (connectorId && connectorIds.has(connectorId)) {
      next.add(token);
    }
  }
  return { tokens: next, pruned: next.size !== tokens.size };
}

export function applySourceToggle(params: {
  sourceIds: ReadonlySet<string>;
  actionRefTokens: ReadonlySet<string>;
  toggledSourceId: string;
  sources: ReadonlyArray<ProductWizardSourceRef>;
}): { sourceIds: Set<string>; actionRefTokens: Set<string>; pruned: boolean } {
  const sourceIds = new Set(params.sourceIds);
  if (sourceIds.has(params.toggledSourceId)) {
    sourceIds.delete(params.toggledSourceId);
  } else {
    sourceIds.add(params.toggledSourceId);
  }
  const connectorIds = connectorIdsForSelectedSources(params.sources, sourceIds);
  const reconciled = reconcileActionTokens(params.actionRefTokens, connectorIds);
  return {
    sourceIds,
    actionRefTokens: reconciled.tokens,
    pruned: reconciled.pruned,
  };
}

function labelsForActionTokens(
  tokens: readonly string[],
  actions: ReadonlyArray<ProductWizardActionRef> | undefined,
): string[] {
  return tokens.map((token) => {
    const fromCatalog = actions?.find((action) => actionRefToken(action) === token);
    const displayName = fromCatalog?.displayName?.trim();
    if (displayName) {
      return displayName;
    }
    return actionLabelFromToken(token);
  });
}

/** 已选动作里，connectorId 不在已选数据源上的那些。未提供数据源目录时不判断。 */
export function productWizardSourceActionMismatch(params: {
  sourceIds: ReadonlySet<string>;
  actionRefTokens: ReadonlySet<string>;
  sources?: ReadonlyArray<ProductWizardSourceRef>;
  actions?: ReadonlyArray<ProductWizardActionRef>;
}): string | null {
  if (!params.sources || params.sourceIds.size === 0 || params.actionRefTokens.size === 0) {
    return null;
  }
  const connectorIds = connectorIdsForSelectedSources(params.sources, params.sourceIds);
  const mismatched = misalignedActionTokens(params.actionRefTokens, connectorIds);
  if (mismatched.length === 0) {
    return null;
  }
  return formatSourceActionMismatchMessage(labelsForActionTokens(mismatched, params.actions));
}

export function productWizardValidationContext(input: {
  sources: ReadonlyArray<ProductWizardSourceRef>;
  actions: ReadonlyArray<ProductWizardActionRef>;
  seatCount: number;
}): ProductWizardValidationContext {
  return {
    sourceCount: input.sources.length,
    actionCount: input.actions.length,
    seatCount: input.seatCount,
    sources: input.sources,
    actions: input.actions,
  };
}

export function validateProductWizardStep(
  step: ProductWizardStep,
  draft: ProductWizardDraft,
  ctx: ProductWizardValidationContext,
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
    const connectorIds =
      ctx.sources != null ? connectorIdsForSelectedSources(ctx.sources, draft.sourceIds) : null;
    if (draft.sourceIds.size === 0 || draft.actionRefTokens.size === 0) {
      if (
        connectorIds &&
        ctx.actions &&
        draft.sourceIds.size > 0 &&
        draft.actionRefTokens.size === 0 &&
        filterActionsForConnectorIds(ctx.actions, connectorIds).length === 0
      ) {
        return {
          ok: false,
          message: PRODUCT_WIZARD_NO_ALIGNED_ACTIONS_MESSAGE,
          missing: ["actions"],
        };
      }
      return { ok: false, message: "请至少选择一个数据源和一个动作。", missing: [] };
    }
    const mismatch = productWizardSourceActionMismatch({
      sourceIds: draft.sourceIds,
      actionRefTokens: draft.actionRefTokens,
      sources: ctx.sources,
      actions: ctx.actions,
    });
    if (mismatch) {
      return { ok: false, message: mismatch, missing: [] };
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
