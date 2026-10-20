/**
 * 成本控制闸口的运行时强制点（R23.1 / R23.2 / R23.3）。
 *
 * 受控资源调用（AI 调用、Bot 创建）在执行前必须经过本模块校验：预算超限且对应控制项
 * 启用时，在执行前拒绝。这是「执行前拦截」的唯一可复用入口，供运行时 AI 调用路径与
 * `resources.create-bot` handler 复用，确保控制点不被绕过。
 */

import { getBudget } from "./budgets-store.js";
import { evaluateGate, type GateAction, type GateDecision } from "./control.js";
import { computeBudgetStatus } from "./runtime.js";

/**
 * 在执行前评估某企业的受控调用是否放行。
 * 未配置预算 / 未启用控制项 → 放行；预算超限且控制项启用 → 拒绝（带原因）。
 *
 * 纯读路径（不产生计费副作用）：被拒请求不写入任何用量（R23 闭环不变量）。
 */
export async function enforceCostControl(args: {
  enterpriseId: string;
  action: GateAction;
  now?: Date;
}): Promise<GateDecision> {
  const budget = await getBudget(args.enterpriseId);
  const status = await computeBudgetStatus(args.enterpriseId, args.now);
  return evaluateGate({
    action: args.action,
    budgetLevel: status.level,
    controls: budget?.controls ?? {
      limitAiCalls: false,
      limitBotCreation: false,
      autoDowngrade: false,
    },
  });
}
