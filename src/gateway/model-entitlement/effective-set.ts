/**
 * EffectiveModelSet 纯函数内核。
 *
 * 设计：
 * - `.kiro/specs/model-entitlement-chain/design.md`（§5.5 / §6.1）
 * - `.kiro/specs/enterprise-ai-model-governance/design.md`（Ceiling）
 *
 * EnterpriseModelCeiling = SubscriptionModelSet ∪ ActiveTenantOwnedModelSet
 * ActiveModelSet         = PlatformCatalogActive ∪ ActiveTenantOwnedModelSet
 * EffectiveModelSet      = Ceiling ∩ SeatOrEmployeeGrant ∩ ActiveModelSet
 *
 * 本模块为纯函数，不得 import 任何 IO / gateway / lit。
 */

import type {
  EffectiveModelSetResult,
  EnterpriseModelEntitlement,
  ModelRef,
  SeatModelGrant,
} from "./types.js";

function unique(values: readonly ModelRef[]): ModelRef[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

function intersect(a: readonly ModelRef[], b: readonly ModelRef[]): ModelRef[] {
  const setB = new Set(b);
  return unique(a).filter((id) => setB.has(id));
}

export type ComputeEffectiveModelSetInput = {
  /** 企业套餐 entitlement；null/undefined 表示「未配置/未迁移」。 */
  entitlement: EnterpriseModelEntitlement | null | undefined;
  /** 席位/员工授权；null/undefined 表示「该 seat 无显式授权」。 */
  grant: SeatModelGrant | null | undefined;
  /** 平台目录中 status=active 的 modelId 列表。 */
  catalogActiveModelIds: readonly ModelRef[];
  /**
   * 租户 BYOK 已启用且健康（或允许健康态）的 runtimeModelId。
   * 同时进入 Ceiling 与 ActiveModelSet。
   */
  tenantOwnedActiveModelIds?: readonly ModelRef[];
  /**
   * 无 active grant 时是否继承企业 Ceiling 全集。
   * 默认 false（最小授权）；迁移期可由灰度开关显式置 true。
   */
  seatGrantInheritsEnterprise?: boolean;
  /**
   * 平台模型连通集合。传入时，非 `ent/` 且不在该集合内的 id 退出 Ceiling 与 ActiveModelSet。
   * 省略时不按连通过滤（纯函数单测保持原语义）。
   */
  platformConnectedModelIds?: readonly ModelRef[];
};

/**
 * 计算员工有效模型集合。结果中的 `state` 区分「未配置」与「已解析」，
 * 调用方据此决定「灰度放行」还是「hard deny」。
 *
 * 「未配置」仅当：无 entitlement 且无租户自有模型。
 * 仅有 BYOK 时视为已解析（subscription 为空，ceiling = tenantOwned）。
 */
export function computeEffectiveModelSet(
  input: ComputeEffectiveModelSetInput,
): EffectiveModelSetResult {
  const platformCatalog = unique(input.catalogActiveModelIds);
  const tenantOwned = unique(input.tenantOwnedActiveModelIds ?? []);
  const activeSet = unique([...platformCatalog, ...tenantOwned]);

  const hasSubscription = Boolean(input.entitlement);
  const hasTenantOwned = tenantOwned.length > 0;

  // 未配置 / 未迁移：无企业 entitlement 且无 BYOK 资产。
  if (!hasSubscription && !hasTenantOwned) {
    return {
      allowedModelIds: [],
      state: "missing",
      reason: "no enterprise model entitlement for tenant",
      source: "none",
    };
  }

  const subscriptionSet = hasSubscription ? unique(input.entitlement!.allowedModelIds) : [];
  const connected =
    input.platformConnectedModelIds === undefined
      ? null
      : new Set(unique(input.platformConnectedModelIds));
  const keepVisible = (id: ModelRef) =>
    connected === null || id.startsWith("ent/") || connected.has(id);
  const enterpriseCeiling = unique([...subscriptionSet, ...tenantOwned]).filter(keepVisible);
  const visibleActive = activeSet.filter(keepVisible);

  // 已解析：先确定 seat 维度集合。
  // active 但 grantedModelIds 为空视为「无有效 grant」，允许迁移期继承企业 Ceiling。
  const hasActiveGrant = Boolean(
    input.grant &&
    input.grant.status === "active" &&
    unique(input.grant.grantedModelIds).length > 0,
  );
  const seatSet = hasActiveGrant
    ? unique(input.grant!.grantedModelIds)
    : input.seatGrantInheritsEnterprise
      ? enterpriseCeiling
      : [];

  // Ceiling ∩ seat ∩ ActiveModelSet（连通过滤后的可见集合）
  const allowedModelIds = intersect(intersect(enterpriseCeiling, seatSet), visibleActive);

  let source: EffectiveModelSetResult["source"] = "entitlement";
  let reason = "resolved from enterprise ceiling ∩ seat grant ∩ active model set";
  if (allowedModelIds.length === 0) {
    if (enterpriseCeiling.length === 0) {
      source = "entitlement";
      reason = "enterprise model ceiling is empty";
    } else if (!hasActiveGrant && !input.seatGrantInheritsEnterprise) {
      source = "grant";
      reason = "no active seat/employee grant";
    } else if (intersect(enterpriseCeiling, visibleActive).length === 0) {
      source = "catalog";
      reason = "no ceiling model is active";
    } else {
      source = "grant";
      reason = "seat grant does not intersect enterprise ceiling";
    }
  } else if (hasActiveGrant) {
    source = "grant";
  }

  return {
    allowedModelIds,
    state: "resolved",
    reason,
    source,
    ...(input.entitlement?.budgetRef ? { budgetRef: input.entitlement.budgetRef } : {}),
  };
}

/**
 * 给定 EffectiveModelSet，判断一个 modelId 是否被授权（hard 判定）。
 * 仅在 `state="resolved"` 时有意义；`missing` 态由调用方按灰度开关处理。
 */
export function isModelAllowed(result: EffectiveModelSetResult, modelId: ModelRef): boolean {
  return result.state === "resolved" && result.allowedModelIds.includes(modelId.trim());
}
