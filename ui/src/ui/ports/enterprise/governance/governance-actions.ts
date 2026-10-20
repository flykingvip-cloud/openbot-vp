/**
 * Governance Actions — 治理动作执行
 *
 * 执行治理动作（暂停/限流/下线/归档等），成功后从队列移除治理项并写入审计日志。
 */

import type {
  GovernanceActionParams,
  GovernanceActionResult,
  GovernanceActionType,
  GovernanceAuditEntry,
  GovernanceItem,
} from "./types.ts";

// ─── Action Validation ─────────────────────────────────────────────────────────

const CRITICAL_ACTIONS: GovernanceActionType[] = ["pause", "throttle", "offline"];
const WARNING_ACTIONS: GovernanceActionType[] = ["downgrade_model", "set_budget_cap", "mark_known"];
const INFO_ACTIONS: GovernanceActionType[] = ["archive", "merge", "ignore"];

/**
 * 验证动作类型是否适用于给定的治理项级别。
 */
export function isValidActionForLevel(
  actionType: GovernanceActionType,
  level: GovernanceItem["level"],
): boolean {
  switch (level) {
    case "critical":
      return CRITICAL_ACTIONS.includes(actionType);
    case "warning":
      return WARNING_ACTIONS.includes(actionType);
    case "info":
      return INFO_ACTIONS.includes(actionType);
  }
}

/**
 * 获取给定级别可用的动作列表。
 */
export function availableActionsForLevel(level: GovernanceItem["level"]): GovernanceActionType[] {
  switch (level) {
    case "critical":
      return [...CRITICAL_ACTIONS];
    case "warning":
      return [...WARNING_ACTIONS];
    case "info":
      return [...INFO_ACTIONS];
  }
}

/**
 * 获取动作的中文标签。
 */
export function actionLabel(actionType: GovernanceActionType): string {
  switch (actionType) {
    case "pause":
      return "暂停";
    case "throttle":
      return "限流";
    case "offline":
      return "下线";
    case "downgrade_model":
      return "降级模型";
    case "set_budget_cap":
      return "设置预算上限";
    case "mark_known":
      return "标记为已知问题";
    case "archive":
      return "归档";
    case "merge":
      return "合并";
    case "ignore":
      return "忽略";
  }
}

// ─── Action Execution ──────────────────────────────────────────────────────────

export type GovernanceActionExecutor = {
  /** 执行治理动作 */
  execute(params: GovernanceActionParams): Promise<GovernanceActionResult>;
  /** 获取审计日志 */
  getAuditLog(): GovernanceAuditEntry[];
};

/**
 * 创建治理动作执行器。
 *
 * @param onTargetStateChange - 回调：更新目标对象状态（由调用方实现具体逻辑）
 */
export function createGovernanceActionExecutor(
  onTargetStateChange: (params: {
    targetId: string;
    targetKind: "agent" | "group";
    actionType: GovernanceActionType;
  }) => Promise<{ ok: true } | { ok: false; error: string }>,
): GovernanceActionExecutor {
  const auditLog: GovernanceAuditEntry[] = [];

  return {
    async execute(params: GovernanceActionParams): Promise<GovernanceActionResult> {
      // 执行目标对象状态变更
      const result = await onTargetStateChange({
        targetId: params.targetId,
        targetKind: params.targetKind,
        actionType: params.actionType,
      });

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      // 写入审计日志
      const entry: GovernanceAuditEntry = {
        issueId: params.issueId,
        actionType: params.actionType,
        targetId: params.targetId,
        targetKind: params.targetKind,
        operatorUserId: params.operatorUserId,
        operatorPositionId: params.operatorPositionId,
        executedAt: new Date().toISOString(),
        reason: params.reason,
      };
      auditLog.push(entry);

      return { ok: true, removedIssueId: params.issueId };
    },

    getAuditLog(): GovernanceAuditEntry[] {
      return [...auditLog];
    },
  };
}

// ─── Queue Management ──────────────────────────────────────────────────────────

/**
 * 从治理队列中移除已处理的治理项。
 * 返回新的队列（不修改原数组）。
 */
export function removeFromQueue(queue: GovernanceItem[], issueId: string): GovernanceItem[] {
  return queue.filter((item) => item.id !== issueId);
}

/**
 * 标记治理项为"忽略"（本周期不再提醒）。
 * 返回被忽略的 issue ID 集合。
 */
export function addToIgnored(ignoredSet: Set<string>, issueId: string): Set<string> {
  const next = new Set(ignoredSet);
  next.add(issueId);
  return next;
}

/**
 * 过滤掉已忽略的治理项。
 */
export function filterIgnored(queue: GovernanceItem[], ignoredSet: Set<string>): GovernanceItem[] {
  return queue.filter((item) => !ignoredSet.has(item.id));
}
