/**
 * Phase 4：模型级预算分账状态（只读核算）。
 *
 * 与套餐总预算（Credits / CreditBucket / tenant-credits）**口径分离**：本模块不读/不改
 * 套餐总预算桶，只把 UsageLedger 里 per-model 的 `creditsCharged` / `providerCostCents`
 * 按周期归集，与绑定上的 `modelBudgets` 上限比较，产出模型级预算状态。
 *
 * 不参与、不改写 Credits 计量主链（record-credit-usage / authorize 均不依赖本模块）。
 */

import { getPlanVersionModelBinding } from "../model-entitlement/plan-version-model-binding-store.js";
import type { ModelBudget } from "../model-entitlement/types.js";
import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import { resolveCycleWindow } from "./runtime.js";
import { getActiveSubscription } from "./subscriptions-store.js";
import { listUsageLedgerEntries } from "./usage-ledger-store.js";

/** 单模型周期内已消耗（Credits + 供应商花费分）。 */
export type PerModelSpend = {
  creditsConsumed: number;
  spendCents: number;
};

/** 单模型预算状态（上限可选；未设上限则该维度不参与超限判定）。 */
export type ModelBudgetStatus = {
  modelId: string;
  creditsConsumed: number;
  monthlyCreditsCap?: number;
  creditsRemaining?: number;
  spendCents: number;
  spendCapCents?: number;
  spendRemainingCents?: number;
  /** 任一已设上限被突破即为 true。 */
  exceeded: boolean;
};

/** 纯函数：按 modelId 归集 UsageLedger 的 creditsCharged / providerCostCents。 */
export function aggregatePerModelSpend(
  entries: readonly UsageLedgerEntry[],
): Map<string, PerModelSpend> {
  const out = new Map<string, PerModelSpend>();
  for (const entry of entries) {
    const modelId = entry.modelId?.trim();
    if (!modelId) {
      continue;
    }
    const prev = out.get(modelId) ?? { creditsConsumed: 0, spendCents: 0 };
    prev.creditsConsumed += Math.max(0, entry.creditsCharged ?? 0);
    prev.spendCents += Math.max(0, entry.providerCostCents ?? 0);
    out.set(modelId, prev);
  }
  return out;
}

/** 纯函数：由周期内 ledger 条目 + 绑定的 modelBudgets 计算每模型预算状态。 */
export function computeModelBudgetStatuses(input: {
  entries: readonly UsageLedgerEntry[];
  modelBudgets: Record<string, ModelBudget>;
}): ModelBudgetStatus[] {
  const spend = aggregatePerModelSpend(input.entries);
  return Object.keys(input.modelBudgets)
    .toSorted()
    .map((modelId) => {
      const budget = input.modelBudgets[modelId] ?? {};
      const used = spend.get(modelId) ?? { creditsConsumed: 0, spendCents: 0 };
      const creditsExceeded =
        budget.monthlyCreditsCap !== undefined && used.creditsConsumed > budget.monthlyCreditsCap;
      const spendExceeded =
        budget.spendCapCents !== undefined && used.spendCents > budget.spendCapCents;
      return {
        modelId,
        creditsConsumed: used.creditsConsumed,
        ...(budget.monthlyCreditsCap !== undefined
          ? {
              monthlyCreditsCap: budget.monthlyCreditsCap,
              creditsRemaining: Math.max(0, budget.monthlyCreditsCap - used.creditsConsumed),
            }
          : {}),
        spendCents: used.spendCents,
        ...(budget.spendCapCents !== undefined
          ? {
              spendCapCents: budget.spendCapCents,
              spendRemainingCents: Math.max(0, budget.spendCapCents - used.spendCents),
            }
          : {}),
        exceeded: creditsExceeded || spendExceeded,
      };
    });
}

export type ResolveModelBudgetStatusesOptions = {
  now?: Date;
  storePaths?: {
    subscriptions?: string;
    planBinding?: string;
    usageLedger?: string;
  };
};

/**
 * 解析某企业当前周期的模型级预算状态：
 * 当前 active 订阅 → 锁定 planVersion 绑定的 modelBudgets → 归集周期 ledger → 计算状态。
 * 无订阅 / 无 modelBudgets 时返回空数组（该能力未启用，不影响主链）。
 */
export async function resolveModelBudgetStatuses(
  enterpriseId: string,
  opts: ResolveModelBudgetStatusesOptions = {},
): Promise<ModelBudgetStatus[]> {
  const subscription = await getActiveSubscription(enterpriseId, opts.storePaths?.subscriptions);
  const planVersionId = subscription?.planVersionId?.trim();
  if (!planVersionId) {
    return [];
  }
  const binding = await getPlanVersionModelBinding(planVersionId, opts.storePaths?.planBinding);
  const modelBudgets = binding?.modelBudgets;
  if (!modelBudgets || Object.keys(modelBudgets).length === 0) {
    return [];
  }
  const { cycleStart, cycleEnd } = resolveCycleWindow(opts.now ?? new Date());
  const entries = await listUsageLedgerEntries(
    enterpriseId,
    { startTime: cycleStart, endTime: cycleEnd },
    opts.storePaths?.usageLedger,
  );
  return computeModelBudgetStatuses({ entries, modelBudgets });
}
