/**
 * 平台「套餐⇄模型」视图模型（纯函数，P6）。
 *
 * 把 overview 聚合投影成两种展示：
 * - 正向：每个套餐 × 平台目录模型的勾选矩阵（运营在套餐下勾选可用模型）。
 * - 反向：每个模型 → 含它的套餐列表（理解 N:N）。
 */

import type { ModelRef, PlatformModelBindingOverview } from "./types.ts";

export type PlanModelCell = {
  modelId: ModelRef;
  /** 该套餐当前是否包含此模型。 */
  included: boolean;
};

export type PlanModelMatrixRow = {
  planId: string;
  name: string;
  status: string;
  currentVersionId: string;
  cells: PlanModelCell[];
};

export type ModelReverseRow = {
  modelId: ModelRef;
  planIds: string[];
  planNames: string[];
};

export type PlatformModelBindingView = {
  catalog: ModelRef[];
  /** 正向矩阵：套餐 → 每个目录模型的勾选态。 */
  matrix: PlanModelMatrixRow[];
  /** 反向视图：模型 → 含它的套餐（按 catalog 顺序）。 */
  reverse: ModelReverseRow[];
};

function dedupeSorted(values: readonly ModelRef[]): ModelRef[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].toSorted();
}

export function buildPlatformModelBindingView(
  overview: PlatformModelBindingOverview,
): PlatformModelBindingView {
  // 目录 = 平台目录 ∪ 任何套餐已绑定的模型（即便已不在目录, 仍要可见以便取消）。
  const allModelIds = dedupeSorted([
    ...overview.catalog,
    ...overview.plans.flatMap((p) => p.allowedModelIds),
  ]);
  const planNameById = new Map(overview.plans.map((p) => [p.planId, p.name]));

  const matrix: PlanModelMatrixRow[] = overview.plans.map((plan) => {
    const included = new Set(plan.allowedModelIds);
    return {
      planId: plan.planId,
      name: plan.name,
      status: plan.status,
      currentVersionId: plan.currentVersionId,
      cells: allModelIds.map((modelId) => ({ modelId, included: included.has(modelId) })),
    };
  });

  const reverse: ModelReverseRow[] = allModelIds.map((modelId) => {
    const planIds = overview.reverseIndex[modelId] ?? [];
    return {
      modelId,
      planIds,
      planNames: planIds.map((id) => planNameById.get(id) ?? id),
    };
  });

  return { catalog: allModelIds, matrix, reverse };
}

/**
 * 切换某套餐对某模型的包含态，产出该套餐**新的 allowedModelIds**（供 set RPC 提交）。
 * 纯函数：基于 overview 当前态计算，不改输入。
 */
export function toggleModelForPlan(
  overview: PlatformModelBindingOverview,
  planId: string,
  modelId: ModelRef,
  included: boolean,
): ModelRef[] {
  const plan = overview.plans.find((p) => p.planId === planId);
  const current = new Set(plan?.allowedModelIds ?? []);
  if (included) {
    current.add(modelId);
  } else {
    current.delete(modelId);
  }
  return [...current];
}
