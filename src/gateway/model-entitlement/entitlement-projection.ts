/**
 * 企业模型 entitlement 投影（P2，任务 9）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§5.3 / 8.1-P2）。
 *
 * 以「当前订阅锁定的 planVersionId」→ 读 PlanVersionModelBinding.allowedModelIds
 * → 投影/刷新 EnterpriseModelEntitlementStore。投影是确定性纯函数（同输入同输出）。
 */

import { loadConfig } from "../../config/config.js";
import { billingEventBus } from "../billing/event-bus.js";
import {
  getActiveSubscription,
  listActiveSubscriptionTenantIds,
  listActiveTenantIdsForPlanVersion,
} from "../billing/subscriptions-store.js";
import { listResourceModelCatalog } from "../resource-catalog/models-catalog-store.js";
import type { ResourceModelCatalogEntry } from "../resource-catalog/types.js";
import { upsertEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import type { ModelEntitlementRoutingMode } from "./entitlement-config.js";
import { resolveModelEntitlementRoutingMode } from "./entitlement-config.js";
import { getPlanVersionModelBinding } from "./plan-version-model-binding-store.js";
import { resolveBindingAllowlist } from "./tier-routing.js";
import type { EnterpriseModelEntitlement, ModelRef } from "./types.js";

/** 投影输入（已解析的订阅 + 绑定切片），便于纯函数测试。 */
export type EntitlementProjectionInput = {
  tenantId: string;
  /** 当前订阅锁定的版本；null 表示无 active 订阅。 */
  planVersionId: string | null;
  /** 该版本的可用模型集合；null 表示该版本尚无绑定。 */
  bindingAllowedModelIds: ModelRef[] | null;
  bindingAllowedTiers?: string[] | null;
  routingMode?: ModelEntitlementRoutingMode;
  catalogEntries?: readonly ResourceModelCatalogEntry[];
  budgetRef?: string;
};

export type EntitlementProjectionResult = {
  /** 是否应写入 entitlement（有 active 订阅时为 true）。 */
  shouldProject: boolean;
  tenantId: string;
  planVersionId?: string;
  /** 投影出的可用模型集合（无绑定 → 空数组，即「已解析但为空」）。 */
  allowedModelIds: ModelRef[];
  budgetRef?: string;
};

/**
 * 纯函数：由订阅锁定版本 + 绑定计算企业 entitlement 投影。
 * - 无 active 订阅（planVersionId=null）→ `shouldProject=false`（不写入，保留 missing 态）。
 * - 有订阅但版本无绑定 → `allowedModelIds=[]`（resolved-empty，hard deny 语义）。
 */
export function computeEntitlementProjection(
  input: EntitlementProjectionInput,
): EntitlementProjectionResult {
  if (!input.planVersionId) {
    return { shouldProject: false, tenantId: input.tenantId, allowedModelIds: [] };
  }
  // Phase 3：默认 tier 口径（tier-backed 绑定按 Tier 投影；无 Tier 时 resolveBindingAllowlist 回退 allowedModelIds）。
  const routingMode = input.routingMode ?? "tier";
  const catalog = input.catalogEntries ?? [];
  const resolved = resolveBindingAllowlist({
    routingMode,
    allowedTiers: input.bindingAllowedTiers,
    allowedModelIds: input.bindingAllowedModelIds ?? [],
    catalog,
  });
  return {
    shouldProject: true,
    tenantId: input.tenantId,
    planVersionId: input.planVersionId,
    allowedModelIds: resolved.modelIds,
    ...(input.budgetRef ? { budgetRef: input.budgetRef } : {}),
  };
}

export type RefreshEntitlementOptions = {
  subscriptionsStorePath?: string;
  planBindingStorePath?: string;
  entitlementStorePath?: string;
  modelCatalogStorePath?: string;
  routingMode?: ModelEntitlementRoutingMode;
  budgetRef?: string;
};

/**
 * 刷新某租户的企业 entitlement：读订阅 + 绑定 → 投影 → 写入 EnterpriseModelEntitlementStore。
 * 无 active 订阅时不写入（返回 null）。订阅/计费域事件、planVersion 激活后调用。
 */
export async function refreshEnterpriseModelEntitlement(
  tenantId: string,
  opts: RefreshEntitlementOptions = {},
): Promise<EnterpriseModelEntitlement | null> {
  const subscription = await getActiveSubscription(tenantId, opts.subscriptionsStorePath);
  const planVersionId = subscription?.planVersionId?.trim() || null;

  const binding = planVersionId
    ? await getPlanVersionModelBinding(planVersionId, opts.planBindingStorePath)
    : null;

  // Phase 3：默认 tier 口径。仅当绑定确有 allowedTiers 时才加载资源目录用于投影，
  // 纯 legacy 绑定（无 Tier）不读目录，沿用 allowedModelIds。
  const routingMode = opts.routingMode ?? "tier";
  const wantsTierProjection = routingMode === "tier" && (binding?.allowedTiers?.length ?? 0) > 0;
  const catalogEntries = wantsTierProjection
    ? await listResourceModelCatalog(opts.modelCatalogStorePath)
    : [];

  const projection = computeEntitlementProjection({
    tenantId,
    planVersionId,
    bindingAllowedModelIds: binding?.allowedModelIds ?? null,
    bindingAllowedTiers: binding?.allowedTiers,
    routingMode,
    catalogEntries,
    ...(opts.budgetRef ? { budgetRef: opts.budgetRef } : {}),
  });

  if (!projection.shouldProject) {
    return null;
  }

  return upsertEnterpriseModelEntitlement(
    {
      tenantId: projection.tenantId,
      allowedModelIds: projection.allowedModelIds,
      ...(projection.planVersionId ? { planVersionId: projection.planVersionId } : {}),
      ...(projection.budgetRef ? { budgetRef: projection.budgetRef } : {}),
    },
    opts.entitlementStorePath,
  );
}

/**
 * 平台修改某 planVersion 的模型绑定后，刷新所有锁定该版本的存量订阅企业 entitlement。
 * 解决「平台改绑定后存量租户拿旧 entitlement」的问题（不依赖之后偶发的订阅变更事件）。
 * 返回被刷新的 tenantId 列表。
 */
export async function refreshEntitlementsForPlanVersion(
  planVersionId: string,
  opts: RefreshEntitlementOptions = {},
): Promise<string[]> {
  const tenantIds = await listActiveTenantIdsForPlanVersion(
    planVersionId,
    opts.subscriptionsStorePath,
  );
  for (const tenantId of tenantIds) {
    await refreshEnterpriseModelEntitlement(tenantId, opts);
  }
  return tenantIds;
}

/**
 * After platform catalog enable/tier changes, re-project all active tenants
 * so disabled models drop immediately without waiting for subscription events.
 */
export async function refreshEntitlementsAfterCatalogChange(
  opts: RefreshEntitlementOptions = {},
): Promise<string[]> {
  const tenantIds = await listActiveSubscriptionTenantIds(opts.subscriptionsStorePath);
  for (const tenantId of tenantIds) {
    await refreshEnterpriseModelEntitlement(tenantId, opts);
  }
  return tenantIds;
}

// ── 事件订阅：subscription 变更 → 刷新企业 entitlement 投影（task 9）────────────

let entitlementConsumerRegistered = false;

/**
 * 注册 billing 事件消费者（幂等，进程内只注册一次）。
 * 收到 `subscription.changed`（订阅/换套餐/激活）→ 重新由锁定版本投影企业 entitlement。
 * 消费幂等：投影为确定性 upsert，重复事件不产生副作用差异。
 */
export function ensureEntitlementProjectionConsumerRegistered(): void {
  if (entitlementConsumerRegistered) {
    return;
  }
  entitlementConsumerRegistered = true;
  billingEventBus.on(async (durable) => {
    if (durable.event.type === "subscription.changed") {
      const cfg = loadConfig();
      await refreshEnterpriseModelEntitlement(durable.event.enterpriseId, {
        routingMode: resolveModelEntitlementRoutingMode(cfg),
      });
    }
  });
}
