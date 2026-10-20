/**
 * 套餐模型绑定一致性核查（只读，基于 bundle overview 投影）。
 *
 * 与 gateway `checkPlanBindingIntegrity` 对齐的 UI 侧子集（不含孤儿 binding）。
 */

import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import type { PlatformPlanBundleVersionRow } from "../../../capability/platform-plan-bundle/index.ts";

export type PlanConsistencyIssueCode =
  | "plan_binding_missing"
  | "plan_binding_empty"
  | "plan_binding_invalid_catalog"
  | "plan_binding_orphan";

export type PlanConsistencyIssue = {
  code: PlanConsistencyIssueCode;
  planId?: string;
  planName?: string;
  versionId: string;
  invalidModelIds?: string[];
  /** 服务端 doctor 原文（优先展示）。 */
  serverMessage?: string;
};

export function auditPlanBindingConsistency(params: {
  plans: readonly Plan[];
  versionMetaById: Readonly<Record<string, PlatformPlanBundleVersionRow>>;
  catalog: readonly string[];
}): PlanConsistencyIssue[] {
  const catalogSet = new Set(params.catalog);
  const issues: PlanConsistencyIssue[] = [];

  for (const plan of params.plans) {
    const versionId = plan.currentVersionId;
    const meta = params.versionMetaById[versionId];
    if (!meta) {
      continue;
    }

    const binding = meta.binding;
    if (meta.bindingState === "missing" || !binding) {
      issues.push({
        code: "plan_binding_missing",
        planId: plan.id,
        planName: plan.name,
        versionId,
      });
      continue;
    }

    const allowedModelIds = binding.allowedModelIds ?? [];
    if (meta.bindingState === "empty" || allowedModelIds.length === 0) {
      issues.push({
        code: "plan_binding_empty",
        planId: plan.id,
        planName: plan.name,
        versionId,
      });
      continue;
    }

    const invalidModelIds = allowedModelIds.filter((modelId) => !catalogSet.has(modelId));
    if (meta.bindingState === "invalid_catalog" || invalidModelIds.length > 0) {
      issues.push({
        code: "plan_binding_invalid_catalog",
        planId: plan.id,
        planName: plan.name,
        versionId,
        invalidModelIds,
      });
    }
  }

  return issues;
}

/** 将 bundle.consistency RPC 结果映射为 UI 行。 */
export function mapRpcConsistencyIssues(
  rpcIssues: ReadonlyArray<{
    code: string;
    planId?: string;
    planVersionId?: string;
    message: string;
  }>,
  plans: readonly Plan[],
): PlanConsistencyIssue[] {
  const planNameById = new Map(plans.map((plan) => [plan.id, plan.name]));
  return rpcIssues
    .filter((issue) => issue.code.startsWith("plan_binding_"))
    .map((issue) => {
      const planId = issue.planId;
      const code = issue.code as PlanConsistencyIssueCode;
      return {
        code,
        planId,
        planName: planId ? planNameById.get(planId) : undefined,
        versionId: issue.planVersionId ?? "",
        serverMessage: issue.message,
      };
    });
}
