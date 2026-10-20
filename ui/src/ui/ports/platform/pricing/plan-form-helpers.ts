import type {
  PlatformPlanBundleVersionRow,
  PlatformPlanModelBudgetEntry,
  PlatformPlanModelQuotaEntry,
} from "../../../capability/platform-plan-bundle/index.ts";

/** 高级模型控制的表单态：每模型两个上限输入（请求数 / token）。 */
export type ModelQuotaFormEntry = {
  maxRequests: string;
  maxTokens: string;
};

/** Phase 4：模型级预算的表单态（每模型 Credits 上限 / 供应商花费上限，单位为元的分按后端口径）。 */
export type ModelBudgetFormEntry = {
  monthlyCreditsCap: string;
  spendCapCents: string;
};

export type DraftAorEditor = {
  enabled: boolean;
  taskTypeId: string;
  selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
  evaluatorMode: string;
};

export type EntitlementEditor = {
  monthlyCredits: string;
  /** 基础 AI 授权数量（字符串便于表单输入）。 */
  aiBasic: string;
  /** 专业 AI 授权数量。 */
  aiPro: string;
  /** 高级 AI 授权数量。 */
  aiElite: string;
  maxConcurrentRuns: string;
  maxWorkflows: string;
  maxKnowledgeBases: string;
  overagePolicyType: "block" | "credits_only" | "pay_as_you_go";
  allowBurstConcurrency: boolean;
  allowedTiers: string[];
  allowedPolicies: string[];
  policyId: string;
  auditLog: boolean;
  mfa: boolean;
  sso: boolean;
  vpcIsolation: boolean;
  allowPrivateModels: boolean;
  allowCustomPolicy: boolean;
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].toSorted();
}

function parseMonthlyCredits(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parseOptionalNonNegativeInt(value?: string): number | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

export function buildDraftAorEditor(
  versionMeta: PlatformPlanBundleVersionRow | null,
): DraftAorEditor {
  const aor = versionMeta?.binding?.aorExecution;
  return {
    enabled: Boolean(aor),
    taskTypeId: aor?.taskTypeId ?? "",
    selectorStrategy: aor?.selectorStrategy ?? "balanced",
    evaluatorMode: aor?.evaluatorMode ?? "",
  };
}

export function buildDraftModelQuota(
  versionMeta: PlatformPlanBundleVersionRow | null,
): Record<string, ModelQuotaFormEntry> {
  return Object.fromEntries(
    Object.entries(versionMeta?.binding?.modelQuota ?? {}).map(([modelId, entry]) => [
      modelId,
      {
        maxRequests: entry?.maxRequests !== undefined ? String(entry.maxRequests) : "",
        maxTokens: entry?.maxTokens !== undefined ? String(entry.maxTokens) : "",
      },
    ]),
  );
}

function parseQuotaField(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function buildModelQuotaForSave(
  allowedModelIds: readonly string[],
  modelQuota: Record<string, ModelQuotaFormEntry>,
): Record<string, PlatformPlanModelQuotaEntry> | undefined {
  const allowed = new Set(allowedModelIds);
  const out: Record<string, PlatformPlanModelQuotaEntry> = {};
  for (const [modelId, entry] of Object.entries(modelQuota)) {
    if (!allowed.has(modelId)) {
      continue;
    }
    const maxRequests = parseQuotaField(entry.maxRequests);
    const maxTokens = parseQuotaField(entry.maxTokens);
    if (maxRequests === undefined && maxTokens === undefined) {
      continue;
    }
    out[modelId] = {
      ...(maxRequests !== undefined ? { maxRequests } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Phase 4：从绑定的 modelBudgets 构建表单态（每模型 Credits / 花费上限字符串）。 */
export function buildDraftModelBudgets(
  versionMeta: PlatformPlanBundleVersionRow | null,
): Record<string, ModelBudgetFormEntry> {
  return Object.fromEntries(
    Object.entries(versionMeta?.binding?.modelBudgets ?? {}).map(([modelId, entry]) => [
      modelId,
      {
        monthlyCreditsCap:
          entry?.monthlyCreditsCap !== undefined ? String(entry.monthlyCreditsCap) : "",
        spendCapCents: entry?.spendCapCents !== undefined ? String(entry.spendCapCents) : "",
      },
    ]),
  );
}

/** Phase 4：把表单态 modelBudgets 收敛为保存载荷（仅保留模型池内、且至少一项上限的条目）。 */
export function buildModelBudgetsForSave(
  allowedModelIds: readonly string[],
  modelBudgets: Record<string, ModelBudgetFormEntry>,
): Record<string, PlatformPlanModelBudgetEntry> | undefined {
  const allowed = new Set(allowedModelIds);
  const out: Record<string, PlatformPlanModelBudgetEntry> = {};
  for (const [modelId, entry] of Object.entries(modelBudgets)) {
    if (!allowed.has(modelId)) {
      continue;
    }
    const monthlyCreditsCap = parseQuotaField(entry.monthlyCreditsCap);
    const spendCapCents = parseQuotaField(entry.spendCapCents);
    if (monthlyCreditsCap === undefined && spendCapCents === undefined) {
      continue;
    }
    out[modelId] = {
      ...(monthlyCreditsCap !== undefined ? { monthlyCreditsCap } : {}),
      ...(spendCapCents !== undefined ? { spendCapCents } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildAorExecutionForSave(aor: DraftAorEditor):
  | {
      taskTypeId: string;
      selectorStrategy: "cheapest" | "best_quality" | "balanced" | "bandit";
      evaluatorMode: string;
    }
  | undefined {
  if (!aor.enabled) {
    return undefined;
  }
  const taskTypeId = aor.taskTypeId.trim();
  const evaluatorMode = aor.evaluatorMode.trim();
  if (!taskTypeId || !evaluatorMode) {
    return undefined;
  }
  return {
    taskTypeId,
    selectorStrategy: aor.selectorStrategy,
    evaluatorMode,
  };
}

export function buildEntitlementEditorFromMeta(
  versionMeta: PlatformPlanBundleVersionRow | null,
  defaultPolicyId = "balanced",
): EntitlementEditor {
  const snap = versionMeta?.entitlementSnapshot;
  const binding = versionMeta?.binding;
  const policyId =
    binding?.policyId?.trim() || snap?.allowedPolicies?.[0]?.trim() || defaultPolicyId;
  const ai = snap?.aiProfileQuota;
  return {
    monthlyCredits: String(snap?.monthlyCredits ?? 0),
    aiBasic: ai?.basic !== undefined ? String(ai.basic) : "",
    aiPro: ai?.pro !== undefined ? String(ai.pro) : "",
    aiElite: ai?.elite !== undefined ? String(ai.elite) : "",
    maxConcurrentRuns: snap?.maxConcurrentRuns !== undefined ? String(snap.maxConcurrentRuns) : "",
    maxWorkflows: snap?.maxWorkflows !== undefined ? String(snap.maxWorkflows) : "",
    maxKnowledgeBases: snap?.maxKnowledgeBases !== undefined ? String(snap.maxKnowledgeBases) : "",
    overagePolicyType: snap?.overagePolicy?.type ?? "block",
    allowBurstConcurrency: snap?.overagePolicy?.allowBurstConcurrency ?? false,
    allowedTiers: uniqueSorted(binding?.allowedTiers ?? snap?.allowedTiers ?? []),
    allowedPolicies: uniqueSorted(binding?.allowedPolicies ?? snap?.allowedPolicies ?? []),
    policyId,
    auditLog: snap?.features?.auditLog === true,
    mfa: snap?.features?.mfa === true,
    sso: snap?.features?.sso === true,
    vpcIsolation: snap?.features?.vpcIsolation === true,
    allowPrivateModels: snap?.allowPrivateModels === true,
    allowCustomPolicy: snap?.allowCustomPolicy === true,
  };
}

export function buildEntitlementPayloadForSave(entitlement: EntitlementEditor): {
  monthlyCredits: number;
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
  maxConcurrentRuns?: number;
  maxWorkflows?: number;
  maxKnowledgeBases?: number;
  overagePolicy: {
    type: "block" | "credits_only" | "pay_as_you_go";
    allowBurstConcurrency: boolean;
  };
  allowedTiers: string[];
  allowedPolicies: string[];
  policyId: string;
  allowPrivateModels: boolean;
  allowCustomPolicy: boolean;
  features: {
    auditLog: boolean;
    mfa: boolean;
    sso: boolean;
    vpcIsolation: boolean;
  };
} {
  const allowedTiers = uniqueSorted(entitlement.allowedTiers);
  const allowedPolicies = uniqueSorted(entitlement.allowedPolicies);
  const policyId = entitlement.policyId.trim() || "balanced";
  const maxConcurrentRuns = parseOptionalNonNegativeInt(entitlement.maxConcurrentRuns);
  const maxWorkflows = parseOptionalNonNegativeInt(entitlement.maxWorkflows);
  const maxKnowledgeBases = parseOptionalNonNegativeInt(entitlement.maxKnowledgeBases);
  const aiBasic = parseOptionalNonNegativeInt(entitlement.aiBasic);
  const aiPro = parseOptionalNonNegativeInt(entitlement.aiPro);
  const aiElite = parseOptionalNonNegativeInt(entitlement.aiElite);
  const aiProfileQuota: Partial<Record<"basic" | "pro" | "elite", number>> = {
    ...(aiBasic !== undefined ? { basic: aiBasic } : {}),
    ...(aiPro !== undefined ? { pro: aiPro } : {}),
    ...(aiElite !== undefined ? { elite: aiElite } : {}),
  };
  return {
    monthlyCredits: parseMonthlyCredits(entitlement.monthlyCredits),
    ...(Object.keys(aiProfileQuota).length > 0 ? { aiProfileQuota } : {}),
    ...(maxConcurrentRuns !== undefined ? { maxConcurrentRuns } : {}),
    ...(maxWorkflows !== undefined ? { maxWorkflows } : {}),
    ...(maxKnowledgeBases !== undefined ? { maxKnowledgeBases } : {}),
    overagePolicy: {
      type: entitlement.overagePolicyType,
      allowBurstConcurrency: entitlement.allowBurstConcurrency,
    },
    allowedTiers,
    allowedPolicies: allowedPolicies.length > 0 ? allowedPolicies : [policyId],
    policyId,
    allowPrivateModels: entitlement.allowPrivateModels,
    allowCustomPolicy: entitlement.allowCustomPolicy,
    features: {
      auditLog: entitlement.auditLog,
      mfa: entitlement.mfa,
      sso: entitlement.sso,
      vpcIsolation: entitlement.vpcIsolation,
    },
  };
}

export function marketingFeaturesFromForm(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function marketingFeaturesToForm(features: readonly string[] | undefined): string {
  return (features ?? []).join("\n");
}
