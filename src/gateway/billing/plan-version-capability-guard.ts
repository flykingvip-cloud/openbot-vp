/**
 * 冻结 active / referenced PlanVersion 的 entitlement / model binding 原地修改。
 * 商业能力变更必须通过追加新 PlanVersion 承载。
 *
 * 规则：
 * - 已被订阅引用 → 任何 entitlement/binding 写入均拒绝
 * - active 且已有对应快照 → 拒绝更新（首次写入在套餐创建流程中放行）
 */

import { getPlanVersion } from "./plans-store.js";
import { isPlanVersionReferenced } from "./subscriptions-store.js";

export class PlanVersionCapabilityFrozenError extends Error {
  readonly code = "PLAN_VERSION_CAPABILITY_FROZEN" as const;

  constructor(message: string) {
    super(message);
    this.name = "PlanVersionCapabilityFrozenError";
  }
}

export type PlanVersionCapabilityWriteKind = "entitlement" | "binding";

/**
 * 若 planVersion 不允许原地修改 entitlement / model binding，则抛出。
 */
export async function assertPlanVersionCapabilityMutable(
  planVersionId: string,
  options: {
    kind: PlanVersionCapabilityWriteKind;
    hasExistingRecord: boolean;
  },
  plansStorePath?: string,
  subscriptionsStorePath?: string,
): Promise<void> {
  const id = planVersionId.trim();
  if (!id) {
    throw new Error("planVersionId is required");
  }

  if (await isPlanVersionReferenced(id, subscriptionsStorePath)) {
    throw new PlanVersionCapabilityFrozenError(
      `套餐版本 ${id} 已被订阅引用，禁止修改权益或模型绑定；请创建新版本。`,
    );
  }

  const version = await getPlanVersion(id, plansStorePath);
  if (version?.status === "active" && options.hasExistingRecord) {
    const label = options.kind === "entitlement" ? "权益快照" : "模型绑定";
    throw new PlanVersionCapabilityFrozenError(
      `套餐版本 ${id} 已生效（active），禁止原地修改${label}；请创建新版本。`,
    );
  }
}
