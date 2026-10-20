/**
 * 平台套餐 → 企业可调用模型（带元数据）的按需解析。
 *
 * Spec: `.kiro/specs/enterprise-ai-model-governance/`（R5.2 平台模型指标与模型池）。
 *
 * 为什么需要：`entitlement-projection.ts` 的投影只在 billing `subscription.changed`
 * 事件或平台显式 refresh 时触发。存量租户（订阅早于该投影上线）从未触发过投影，
 * `EnterpriseModelEntitlementStore` 里没有记录 → `resolveEnterpriseModelCeiling`
 * 的 `subscriptionModelIds` 恒为空 → 企业端「平台提供模型」永远是 0，且 grant
 * 会因 ceiling 为空被硬拒。
 *
 * 这里在**企业读路径**上按需解析「当前订阅锁定版本可调用的模型」，并可选回填
 * entitlement（reconcile）。运行时 gate 不走这里，保持只读、无写盘副作用。
 */

import { loadConfig } from "../../config/config.js";
import { getPlan } from "../billing/plans-store.js";
import { getActiveSubscription } from "../billing/subscriptions-store.js";
import { getEnterpriseModelEntitlement } from "../model-entitlement/enterprise-model-entitlement-store.js";
import { resolveModelEntitlementRoutingMode } from "../model-entitlement/entitlement-config.js";
import { refreshEnterpriseModelEntitlement } from "../model-entitlement/entitlement-projection.js";
import { getPlanVersionModelBinding } from "../model-entitlement/plan-version-model-binding-store.js";
import { resolveBindingAllowlist } from "../model-entitlement/tier-routing.js";
import type { ModelBudget, ModelQuota, ModelRef } from "../model-entitlement/types.js";
import { listResourceModelCatalog } from "../resource-catalog/models-catalog-store.js";
import { listResourceTiers } from "../resource-catalog/tiers-store.js";
import type { ResourceModelCatalogEntry } from "../resource-catalog/types.js";

/**
 * 平台侧模型条目（企业端「平台提供」行的完整展示数据）。
 * 与 BYOK 的 `EnterpriseModelAsset` 平行，但成本口径不同：
 * 平台目录用「每 1M token 整数分」，BYOK 资产用「每 1k token 整数分」。
 */
export type PlatformPlanModelEntry = {
  modelId: ModelRef;
  provider: string;
  displayName: string;
  tier: string;
  tierName?: string;
  capabilities: string[];
  /** 平台目录里的启用态；false 表示已被平台下架但仍留在套餐绑定里。 */
  enabled: boolean;
  contextWindow?: number;
  inputCostPer1MCents?: number;
  outputCostPer1MCents?: number;
  /** 套餐版本对该模型的请求/token guardrail。 */
  quota?: ModelQuota;
  /** 套餐版本对该模型的 credits/spend 预算。 */
  budget?: ModelBudget;
  /**
   * true = 套餐绑定引用了该 modelId，但平台资源目录里查不到条目。
   * 这类模型无法解析 tier/成本，属于需要平台侧修数据的悬空引用。
   */
  catalogMissing: boolean;
};

/**
 * 平台模型集合为空时的可解释原因。UI 据此给出不同的空态与指引，
 * 而不是笼统的「暂无模型」。
 */
export type PlatformPlanModelState =
  /** 有 active 订阅、有绑定、解析出非空模型集合。 */
  | "ok"
  /** 该企业没有 active 订阅 → 平台不下发任何模型。 */
  | "no_subscription"
  /** 有订阅，但订阅锁定的 planVersion 没有模型绑定记录。 */
  | "no_plan_binding"
  /** 有绑定，但按当前口径解析出空集合（Tier 无可用模型 / 绑定为空）。 */
  | "binding_empty";

export type PlatformPlanModelResolution = {
  tenantId: string;
  state: PlatformPlanModelState;
  planId?: string;
  planName?: string;
  planVersionId?: string;
  /** 绑定声明的 Tier（tier 口径下为模型池来源）。 */
  allowedTiers: string[];
  /** 实际生效的解析口径：tier = 按 Tier 投影；models = 按 allowedModelIds。 */
  allowlistSource: "tier" | "models";
  models: PlatformPlanModelEntry[];
  modelIds: ModelRef[];
  /** 已落盘 entitlement 的模型集合（可能缺失或过期）。 */
  entitlementModelIds: ModelRef[];
  /**
   * true = 落盘 entitlement 与实时解析结果不一致（含「完全没有记录」）。
   * reconcile 成功后会被重新解析为 false。
   */
  entitlementStale: boolean;
  /** 本次调用是否真的回填了 entitlement。 */
  reconciled: boolean;
};

export type ResolvePlatformPlanModelsOptions = {
  tenantId: string;
  /**
   * true = 发现 entitlement 与实时解析不一致时回填（写盘）。
   * 仅企业管理读路径使用；运行时 gate 必须保持 false。
   */
  reconcile?: boolean;
  subscriptionsStorePath?: string;
  plansStorePath?: string;
  planBindingStorePath?: string;
  entitlementStorePath?: string;
  modelCatalogStorePath?: string;
  tiersStorePath?: string;
};

function sameModelSet(left: readonly ModelRef[], right: readonly ModelRef[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const set = new Set(left);
  return right.every((id) => set.has(id));
}

function buildEntry(params: {
  modelId: ModelRef;
  catalogEntry: ResourceModelCatalogEntry | undefined;
  tierNameById: Map<string, string>;
  quota: ModelQuota | undefined;
  budget: ModelBudget | undefined;
}): PlatformPlanModelEntry {
  const { modelId, catalogEntry, tierNameById, quota, budget } = params;
  if (!catalogEntry) {
    return {
      modelId,
      provider: modelId.includes("/") ? (modelId.split("/")[0] ?? "") : "",
      displayName: modelId,
      tier: "",
      capabilities: [],
      enabled: false,
      catalogMissing: true,
      ...(quota ? { quota } : {}),
      ...(budget ? { budget } : {}),
    };
  }
  const tierName = tierNameById.get(catalogEntry.tier);
  return {
    modelId,
    provider: catalogEntry.provider,
    displayName: catalogEntry.displayName || modelId,
    tier: catalogEntry.tier,
    ...(tierName ? { tierName } : {}),
    capabilities: [...(catalogEntry.capabilities ?? [])],
    enabled: catalogEntry.enabled,
    ...(catalogEntry.contextWindow != null ? { contextWindow: catalogEntry.contextWindow } : {}),
    inputCostPer1MCents: catalogEntry.inputCostPer1MCents,
    outputCostPer1MCents: catalogEntry.outputCostPer1MCents,
    catalogMissing: false,
    ...(quota ? { quota } : {}),
    ...(budget ? { budget } : {}),
  };
}

/**
 * 解析某企业「当前套餐可调用的平台模型」。
 *
 * 链路：active subscription → planVersionId → PlanVersionModelBinding
 *      → resolveBindingAllowlist(tier | models) → Resource Catalog 补元数据。
 *
 * 不抛错：任一环节缺失都用 `state` 表达原因，交给 UI 给出可操作指引。
 */
export async function resolvePlatformPlanModels(
  options: ResolvePlatformPlanModelsOptions,
): Promise<PlatformPlanModelResolution> {
  const tenantId = options.tenantId;
  const routingMode = resolveModelEntitlementRoutingMode(loadConfig());
  let entitlement = await getEnterpriseModelEntitlement(tenantId, options.entitlementStorePath);

  const subscription = await getActiveSubscription(tenantId, options.subscriptionsStorePath);
  const planVersionId = subscription?.planVersionId?.trim() || null;
  if (!subscription || !planVersionId) {
    return {
      tenantId,
      state: "no_subscription",
      allowedTiers: [],
      allowlistSource: routingMode === "legacy" ? "models" : "tier",
      models: [],
      modelIds: [],
      entitlementModelIds: entitlement?.allowedModelIds ?? [],
      // 无订阅时不投影（与 computeEntitlementProjection 的 shouldProject=false 对齐），
      // 因此也不把「有历史 entitlement」判为 stale：那属于订阅到期后的残留，另有清理路径。
      entitlementStale: false,
      reconciled: false,
    };
  }

  const entitlementIsStale = (expectedModelIds: readonly ModelRef[]): boolean => {
    if (!entitlement) {
      return true;
    }
    return (
      !sameModelSet(entitlement.allowedModelIds, expectedModelIds) ||
      entitlement.planVersionId !== planVersionId
    );
  };

  const reconcileEntitlement = async (expectedModelIds: readonly ModelRef[]) => {
    let entitlementModelIds = entitlement?.allowedModelIds ?? [];
    let entitlementStale = entitlementIsStale(expectedModelIds);
    let reconciled = false;
    if (entitlementStale && options.reconcile) {
      const refreshed = await refreshEnterpriseModelEntitlement(tenantId, {
        routingMode,
        ...(options.subscriptionsStorePath
          ? { subscriptionsStorePath: options.subscriptionsStorePath }
          : {}),
        ...(options.planBindingStorePath
          ? { planBindingStorePath: options.planBindingStorePath }
          : {}),
        ...(options.entitlementStorePath
          ? { entitlementStorePath: options.entitlementStorePath }
          : {}),
        ...(options.modelCatalogStorePath
          ? { modelCatalogStorePath: options.modelCatalogStorePath }
          : {}),
      });
      if (refreshed) {
        entitlement = refreshed;
        entitlementModelIds = refreshed.allowedModelIds;
        entitlementStale = entitlementIsStale(expectedModelIds);
        reconciled = true;
      }
    }
    return { entitlementModelIds, entitlementStale, reconciled };
  };

  const plan = await getPlan(subscription.planId, options.plansStorePath);
  const binding = await getPlanVersionModelBinding(planVersionId, options.planBindingStorePath);
  const planContext = {
    planId: subscription.planId,
    ...(plan?.name ? { planName: plan.name } : {}),
    planVersionId,
  };

  if (!binding) {
    // Active subscriptions without a binding are an explicit empty projection. Reconcile old
    // records so a deleted platform binding cannot leave previously granted models usable.
    const reconciliation = await reconcileEntitlement([]);
    return {
      tenantId,
      state: "no_plan_binding",
      ...planContext,
      allowedTiers: [],
      allowlistSource: routingMode === "legacy" ? "models" : "tier",
      models: [],
      modelIds: [],
      ...reconciliation,
    };
  }

  const allowedTiers = (binding.allowedTiers ?? []).filter((tier) => tier.trim().length > 0);
  const wantsTierProjection = routingMode === "tier" && allowedTiers.length > 0;
  // 与 refreshEnterpriseModelEntitlement 保持一致：纯 legacy 绑定不读目录做投影，
  // 但这里仍需目录来补展示元数据，所以无条件加载一次。
  const catalog = await listResourceModelCatalog(options.modelCatalogStorePath);
  const allowlist = resolveBindingAllowlist({
    routingMode,
    allowedTiers: wantsTierProjection ? allowedTiers : null,
    allowedModelIds: binding.allowedModelIds,
    catalog,
  });

  const tiers = await listResourceTiers(options.tiersStorePath);
  const tierNameById = new Map(tiers.map((tier) => [tier.id, tier.name]));
  const catalogById = new Map(catalog.map((entry) => [entry.modelId, entry]));

  const models = allowlist.modelIds.map((modelId) =>
    buildEntry({
      modelId,
      catalogEntry: catalogById.get(modelId),
      tierNameById,
      quota: binding.modelQuota?.[modelId],
      budget: binding.modelBudgets?.[modelId],
    }),
  );

  const reconciliation = await reconcileEntitlement(allowlist.modelIds);

  return {
    tenantId,
    state: allowlist.modelIds.length > 0 ? "ok" : "binding_empty",
    ...planContext,
    allowedTiers,
    allowlistSource: allowlist.source,
    models,
    modelIds: allowlist.modelIds,
    ...reconciliation,
  };
}
