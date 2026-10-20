import type {
  MeterDefinition,
  PlanVersion,
} from "../../../capability/cost-budget-billing/index.ts";
import type {
  PlatformPlanBundleCreateVersionResponse,
  PlatformPlanBundleGateway,
  PlatformPlanBundleVersionRow,
} from "../../../capability/platform-plan-bundle/index.ts";
import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type { ResourceTier } from "../../../capability/resource-catalog/index.ts";
import type { EntitlementDiffRow } from "./commercial-display.ts";
import type { ModelBindingDiff } from "./plan-activate-confirm-panel.ts";
import {
  buildAorExecutionForSave,
  buildDraftAorEditor,
  buildDraftModelBudgets,
  buildDraftModelQuota,
  buildEntitlementEditorFromMeta,
  buildEntitlementPayloadForSave,
  buildModelBudgetsForSave,
  buildModelQuotaForSave,
  type DraftAorEditor,
  type EntitlementEditor,
  type ModelBudgetFormEntry,
  type ModelQuotaFormEntry,
} from "./plan-form-helpers.ts";

export type DraftPricingRow = { type: "seat" | "usage" | "extra"; key: string; priceYuan: string };

/** 草稿计量合同（与 MeterDefinition 字段对齐，配额用字符串便于输入）。 */
export type DraftMeterRow = {
  key: string;
  unit: MeterDefinition["unit"];
  includedQuota: string;
  /** 套餐内：free | usage_priced */
  includedMode: "free" | "usage_priced";
  /** 超额：block | paid */
  overageMode: "block" | "paid";
};

export type DraftEditorState = {
  planId: string;
  versionId: string;
  rows: DraftPricingRow[];
  meters: DraftMeterRow[];
  catalog: string[];
  allowedModelIds: string[];
  modelQuota: Record<string, ModelQuotaFormEntry>;
  modelBudgets: Record<string, ModelBudgetFormEntry>;
  aor: DraftAorEditor;
  entitlement: EntitlementEditor;
};

export function meterSemanticsLabel(
  row: Pick<DraftMeterRow, "includedMode" | "overageMode">,
): string {
  const included = row.includedMode === "free" ? "套餐内免费" : "套餐内按量收费";
  const overage = row.overageMode === "block" ? "禁止超额" : "允许付费超额";
  return `${included} · ${overage}`;
}

export function buildVersionMeterRows(version: PlanVersion): DraftMeterRow[] {
  const meters = version.snapshot.meters ?? [];
  if (meters.length > 0) {
    return meters.map((m) => ({
      key: m.key,
      unit: m.unit,
      includedQuota: m.includedQuota !== undefined ? String(m.includedQuota) : "",
      includedMode: m.chargeIncludedAtUsagePrice ? "usage_priced" : "free",
      overageMode: m.allowOverage ? "paid" : "block",
    }));
  }
  // 无冻结 meters：从 pricing 的 usage/extra key 合成可编辑行
  const keys = new Set<string>();
  for (const p of version.snapshot.pricing) {
    if (p.type === "usage" || p.type === "extra") {
      keys.add(p.key);
    }
  }
  return [...keys].toSorted().map((key) => {
    const hasUsage = version.snapshot.pricing.some((p) => p.type === "usage" && p.key === key);
    const hasExtra = version.snapshot.pricing.some((p) => p.type === "extra" && p.key === key);
    return {
      key,
      unit: key.includes("credit")
        ? "credit"
        : key.includes("token")
          ? "token"
          : ("count" as const),
      includedQuota: "",
      includedMode: hasUsage && key !== "ai_credits" ? "usage_priced" : "free",
      overageMode: hasExtra ? "paid" : "block",
    };
  });
}

export function draftMetersToPayload(meters: readonly DraftMeterRow[]): MeterDefinition[] {
  return meters
    .filter((m) => m.key.trim().length > 0)
    .map((m) => {
      const quotaRaw = m.includedQuota.trim();
      const includedQuota =
        quotaRaw === "" ? undefined : Math.max(0, Math.round(Number.parseInt(quotaRaw, 10) || 0));
      return {
        key: m.key.trim(),
        unit: m.unit,
        ...(includedQuota !== undefined ? { includedQuota } : {}),
        chargeIncludedAtUsagePrice: m.includedMode === "usage_priced",
        allowOverage: m.overageMode === "paid",
        aggregate: "sum" as const,
        rounding: "integer" as const,
      };
    });
}

export type ActivateConfirmState = {
  planId: string;
  versionId: string;
  versionNumber: number;
  diff: null;
  bindingDiff: ModelBindingDiff | null;
  entitlementDiff: EntitlementDiffRow[];
  diffLoading: boolean;
};

export type DeleteConfirmState = {
  planId: string;
  versionId: string;
  versionNumber: number;
};

type BuildDraftEditorStateParams = {
  planId: string;
  version: PlanVersion;
  versionMeta: PlatformPlanBundleVersionRow | null;
  bundleCatalog: string[];
  defaultPolicyId?: string;
  centsToYuan: (cents: number) => string;
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].toSorted();
}

export function buildVersionPricingRows(
  version: PlanVersion,
  centsToYuan: (cents: number) => string,
): DraftPricingRow[] {
  return version.snapshot.pricing.map((p) => ({
    type: p.type,
    key: p.key,
    priceYuan: centsToYuan(p.priceCents),
  }));
}

export function buildDraftEditorState(params: BuildDraftEditorStateParams): DraftEditorState {
  return {
    planId: params.planId,
    versionId: params.version.id,
    rows: buildVersionPricingRows(params.version, params.centsToYuan),
    meters: buildVersionMeterRows(params.version),
    catalog: uniqueSorted([
      ...params.bundleCatalog,
      ...(params.versionMeta?.binding?.allowedModelIds ?? []),
    ]),
    allowedModelIds: uniqueSorted(params.versionMeta?.binding?.allowedModelIds ?? []),
    modelQuota: buildDraftModelQuota(params.versionMeta),
    modelBudgets: buildDraftModelBudgets(params.versionMeta),
    aor: buildDraftAorEditor(params.versionMeta),
    entitlement: buildEntitlementEditorFromMeta(
      params.versionMeta,
      params.defaultPolicyId ?? "balanced",
    ),
  };
}

type BuildActivateConfirmStateParams = {
  planId: string;
  version: PlanVersion;
  activeVersion: PlanVersion | null;
  catalogTiers: ResourceTier[];
  catalogPolicies: RoutingPolicy[];
  getVersionMeta: (versionId: string) => PlatformPlanBundleVersionRow | null;
  computeModelBindingDiff: (
    fromMeta: PlatformPlanBundleVersionRow | null,
    toMeta: PlatformPlanBundleVersionRow | null,
  ) => ModelBindingDiff | null;
  computeEntitlementDiff: (
    fromMeta: PlatformPlanBundleVersionRow | null,
    toMeta: PlatformPlanBundleVersionRow | null,
    catalogTiers: ResourceTier[],
    catalogPolicies: RoutingPolicy[],
  ) => EntitlementDiffRow[];
};

export function buildActivateConfirmState(
  params: BuildActivateConfirmStateParams,
): ActivateConfirmState {
  return {
    planId: params.planId,
    versionId: params.version.id,
    versionNumber: params.version.version,
    diff: null,
    bindingDiff: params.computeModelBindingDiff(
      params.activeVersion ? params.getVersionMeta(params.activeVersion.id) : null,
      params.getVersionMeta(params.version.id),
    ),
    entitlementDiff: params.computeEntitlementDiff(
      params.activeVersion ? params.getVersionMeta(params.activeVersion.id) : null,
      params.getVersionMeta(params.version.id),
      params.catalogTiers,
      params.catalogPolicies,
    ),
    diffLoading: true,
  };
}

export function buildDeleteConfirmState(
  planId: string,
  version: Pick<PlanVersion, "id" | "version">,
): DeleteConfirmState {
  return {
    planId,
    versionId: version.id,
    versionNumber: version.version,
  };
}

type RequestCreateDraftVersionParams = {
  gateway: PlatformPlanBundleGateway;
  planId: string;
  pricing: Array<{ type: "seat" | "usage" | "extra"; key: string; priceCents: number }>;
  versionMeta: PlatformPlanBundleVersionRow | null;
  /** Tier 自动解析出的模型池。Phase 1：allowedModelIds 由 Tier 派生，不是手工真相。 */
  resolvedModelIds: readonly string[];
  defaultPolicyId?: string;
};

export async function requestCreateDraftVersion(
  params: RequestCreateDraftVersionParams,
): Promise<PlatformPlanBundleCreateVersionResponse> {
  const versionMeta = params.versionMeta;
  const allowedModelIds = uniqueSorted(params.resolvedModelIds);
  const filteredQuota = Object.fromEntries(
    Object.entries(versionMeta?.binding?.modelQuota ?? {}).filter(([modelId]) =>
      allowedModelIds.includes(modelId),
    ),
  );
  const filteredBudgets = Object.fromEntries(
    Object.entries(versionMeta?.binding?.modelBudgets ?? {}).filter(([modelId]) =>
      allowedModelIds.includes(modelId),
    ),
  );
  return params.gateway.createVersion({
    planId: params.planId,
    pricing: params.pricing,
    allowedModelIds,
    ...buildEntitlementPayloadForSave(
      buildEntitlementEditorFromMeta(versionMeta, params.defaultPolicyId ?? "balanced"),
    ),
    ...(Object.keys(filteredQuota).length > 0 ? { modelQuota: filteredQuota } : {}),
    ...(Object.keys(filteredBudgets).length > 0 ? { modelBudgets: filteredBudgets } : {}),
    ...(versionMeta?.binding?.aorExecution
      ? { aorExecution: versionMeta.binding.aorExecution }
      : {}),
  });
}

type RequestSaveDraftVersionParams = {
  gateway: PlatformPlanBundleGateway;
  editor: DraftEditorState;
  /** Tier 自动解析出的模型池。Phase 1：覆盖 editor 内的历史 allowedModelIds。 */
  resolvedModelIds: readonly string[];
  yuanToCents: (value: string) => number;
};

export async function requestSaveDraftVersion(
  params: RequestSaveDraftVersionParams,
): Promise<PlatformPlanBundleCreateVersionResponse> {
  const allowedModelIds = uniqueSorted(params.resolvedModelIds);
  const modelQuota = buildModelQuotaForSave(allowedModelIds, params.editor.modelQuota);
  const modelBudgets = buildModelBudgetsForSave(allowedModelIds, params.editor.modelBudgets);
  const meters = draftMetersToPayload(params.editor.meters);
  return params.gateway.createVersion({
    planId: params.editor.planId,
    pricing: params.editor.rows.map((r) => ({
      type: r.type,
      key: r.key.trim(),
      priceCents: params.yuanToCents(r.priceYuan),
    })),
    ...(meters.length > 0 ? { meters } : {}),
    allowedModelIds,
    ...buildEntitlementPayloadForSave(params.editor.entitlement),
    ...(modelQuota ? { modelQuota } : {}),
    ...(modelBudgets ? { modelBudgets } : {}),
    ...(buildAorExecutionForSave(params.editor.aor)
      ? { aorExecution: buildAorExecutionForSave(params.editor.aor)! }
      : {}),
  });
}

export async function requestActivateVersion(params: {
  gateway: PlatformPlanBundleGateway;
  planId: string;
  versionId: string;
}) {
  return params.gateway.activate({
    planId: params.planId,
    versionId: params.versionId,
    requestId: `activate-${params.versionId}`,
  });
}

export async function requestDeprecateVersion(params: {
  gateway: PlatformPlanBundleGateway;
  planId: string;
  versionId: string;
}) {
  return params.gateway.deprecate({
    planId: params.planId,
    versionId: params.versionId,
  });
}

export async function requestDeleteVersion(params: {
  gateway: PlatformPlanBundleGateway;
  planId: string;
  versionId: string;
}) {
  return params.gateway.deleteVersion({
    planId: params.planId,
    versionId: params.versionId,
  });
}
