/**
 * Auto Governance Engine
 * Automatically executes governance actions based on rules.
 */

import * as aiAssets from "../ai-assets/store.js";
import type {
  AiMetricsDaily,
  AutoGovernanceResult,
  AutoGovernanceRule,
  GovernanceActionRecord,
  GovernanceActionStatus,
  GovernanceActionType,
  GovernanceTrigger,
} from "../shared/types.js";
import { generateActionId } from "../shared/utils.js";

// ============================================================================
// In-Memory Store
// ============================================================================

const actionsStore = new Map<string, GovernanceActionRecord>();

// ============================================================================
// Default Auto Governance Rules
// ============================================================================

export const DEFAULT_AUTO_GOVERNANCE_RULES: AutoGovernanceRule[] = [
  // Rule 1: Empty running bot - pause automatically
  {
    id: "rule_empty_bot",
    name: "空跑机器人",
    condition: (metrics, history) => {
      // Check if task_count == 0 AND cost > 0 for 2+ days
      const hasCostNoTask = metrics.taskCount === 0 && metrics.totalCost > 0;
      const hasHistory = history.length >= 1;
      const prevDayAlsoEmpty = hasHistory && history[0].taskCount === 0 && history[0].totalCost > 0;
      return hasCostNoTask && prevDayAlsoEmpty;
    },
    action: "pause",
    severity: "low",
    autoExecute: true,
    description: "Bot has cost but no tasks for 2+ days - auto pause",
  },

  // Rule 2: Cost spike - notify admin
  {
    id: "rule_cost_spike",
    name: "成本暴涨",
    condition: (metrics) => {
      return metrics.costGrowthRate > 0.5; // > 50% growth
    },
    action: "notify_admin",
    severity: "medium",
    autoExecute: false, // Notification only
    description: "Cost increased by > 50% compared to yesterday",
  },

  // Rule 3: High failure rate - mark risk
  {
    id: "rule_high_failure",
    name: "失败率高",
    condition: (metrics) => {
      const failRate = metrics.taskCount > 0 ? metrics.failCount / metrics.taskCount : 0;
      return failRate > 0.4; // > 40% failure rate
    },
    action: "mark_risk",
    severity: "high",
    autoExecute: true,
    description: "Failure rate > 40%",
  },

  // Rule 4: Low efficiency score - recommend optimization
  {
    id: "rule_low_efficiency",
    name: "低效机器人",
    condition: (metrics) => {
      // This will be calculated in context - simplified here
      return metrics.successRate < 0.3 && metrics.taskCount > 5;
    },
    action: "recommend_optimization",
    severity: "medium",
    autoExecute: false, // Recommendation only
    description: "Success rate < 30% with sufficient tasks",
  },
];

let activeRules: AutoGovernanceRule[] = [...DEFAULT_AUTO_GOVERNANCE_RULES];

// ============================================================================
// Rule Management
// ============================================================================

export function getActiveRules(): AutoGovernanceRule[] {
  return [...activeRules];
}

export function addRule(rule: AutoGovernanceRule): void {
  activeRules.push(rule);
}

export function removeRule(ruleId: string): void {
  activeRules = activeRules.filter((r) => r.id !== ruleId);
}

export function resetRules(): void {
  activeRules = [...DEFAULT_AUTO_GOVERNANCE_RULES];
}

// ============================================================================
// Action Execution
// ============================================================================

async function executeAction(
  assetId: string,
  action: GovernanceActionType,
  reason: string,
  trigger: GovernanceTrigger = "auto_governance",
  autoExecute: boolean,
): Promise<GovernanceActionRecord> {
  const id = generateActionId();
  const now = new Date().toISOString();

  const record: GovernanceActionRecord = {
    id,
    assetId,
    action,
    trigger,
    reason,
    status: "pending",
    createdAt: now,
  };

  // Auto-execute if configured
  if (autoExecute) {
    try {
      switch (action) {
        case "pause":
          await aiAssets.pauseAsset(assetId, reason);
          record.status = "executed";
          record.executedAt = new Date().toISOString();
          break;
        case "resume":
          await aiAssets.resumeAsset(assetId);
          record.status = "executed";
          record.executedAt = new Date().toISOString();
          break;
        case "mark_risk":
          // Mark asset as high risk
          await aiAssets.markAssetError(assetId, "auto_governance_risk");
          record.status = "executed";
          record.executedAt = new Date().toISOString();
          break;
        case "notify_admin":
        case "recommend_optimization":
          // These are notification-only, mark as executed (notification sent)
          record.status = "executed";
          record.executedAt = new Date().toISOString();
          break;
        default:
          record.status = "pending"; // Requires manual execution
      }
    } catch (error) {
      record.status = "failed";
      console.error(`[AutoGovernance] Failed to execute ${action} on ${assetId}:`, error);
    }
  }

  actionsStore.set(id, record);
  return record;
}

// ============================================================================
// Auto Governance Evaluation
// ============================================================================

export async function evaluateAsset(
  assetId: string,
  metrics: AiMetricsDaily,
  history: AiMetricsDaily[] = [],
): Promise<AutoGovernanceResult[]> {
  const results: AutoGovernanceResult[] = [];

  for (const rule of activeRules) {
    try {
      const triggered = rule.condition(metrics, history);

      if (triggered) {
        const action = await executeAction(
          assetId,
          rule.action,
          rule.description,
          "auto_governance",
          rule.autoExecute,
        );

        results.push({
          ruleId: rule.id,
          triggered: true,
          action,
          message: rule.autoExecute
            ? `Auto-executed: ${rule.description}`
            : `Notification: ${rule.description}`,
        });
      }
    } catch (error) {
      console.error(`[AutoGovernance] Rule ${rule.id} failed for asset ${assetId}:`, error);
    }
  }

  return results;
}

export async function runBatchEvaluation(
  metricsByAsset: Map<string, AiMetricsDaily>,
  historyByAsset: Map<string, AiMetricsDaily[]>,
): Promise<{
  totalProcessed: number;
  actionsTriggered: number;
  autoExecuted: number;
  errors: number;
}> {
  let totalProcessed = 0;
  let actionsTriggered = 0;
  let autoExecuted = 0;
  let errors = 0;

  for (const [assetId, metrics] of metricsByAsset) {
    try {
      totalProcessed++;
      const history = historyByAsset.get(assetId) ?? [];
      const results = await evaluateAsset(assetId, metrics, history);

      for (const result of results) {
        if (result.triggered) {
          actionsTriggered++;
          if (result.action?.status === "executed") {
            autoExecuted++;
          }
        }
      }
    } catch (error) {
      errors++;
      console.error(`[AutoGovernance] Batch evaluation failed for asset ${assetId}:`, error);
    }
  }

  return { totalProcessed, actionsTriggered, autoExecuted, errors };
}

// ============================================================================
// Action Records
// ============================================================================

export async function getActionById(id: string): Promise<GovernanceActionRecord | null> {
  return actionsStore.get(id) ?? null;
}

export async function listActions(filters: {
  assetId?: string;
  status?: GovernanceActionStatus;
  trigger?: GovernanceTrigger;
  limit?: number;
}): Promise<GovernanceActionRecord[]> {
  let actions = Array.from(actionsStore.values());

  if (filters.assetId) {
    actions = actions.filter((a) => a.assetId === filters.assetId);
  }

  if (filters.status) {
    actions = actions.filter((a) => a.status === filters.status);
  }

  if (filters.trigger) {
    actions = actions.filter((a) => a.trigger === filters.trigger);
  }

  // Sort by created_at descending
  actions = actions.toSorted(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  if (filters.limit) {
    actions = actions.slice(0, filters.limit);
  }

  return actions;
}

export async function getPendingActions(): Promise<GovernanceActionRecord[]> {
  return listActions({ status: "pending" });
}

export async function executePendingAction(
  actionId: string,
  executedBy: string,
): Promise<GovernanceActionRecord | null> {
  const action = actionsStore.get(actionId);
  if (!action || action.status !== "pending") {
    return null;
  }

  try {
    switch (action.action) {
      case "pause":
        await aiAssets.pauseAsset(action.assetId, action.reason);
        break;
      case "resume":
        await aiAssets.resumeAsset(action.assetId);
        break;
      case "limit":
      case "redirect":
        // These would require additional implementation
        console.log(`[AutoGovernance] Executing ${action.action} on ${action.assetId}`);
        break;
      default:
        console.log(`[AutoGovernance] Action ${action.action} does not require execution`);
    }

    const updated: GovernanceActionRecord = {
      ...action,
      status: "executed",
      executedBy,
      executedAt: new Date().toISOString(),
    };

    actionsStore.set(actionId, updated);
    return updated;
  } catch (error) {
    const failed: GovernanceActionRecord = {
      ...action,
      status: "failed",
    };
    actionsStore.set(actionId, failed);
    console.error(`[AutoGovernance] Manual execution failed for ${actionId}:`, error);
    return failed;
  }
}

// ============================================================================
// Store Management
// ============================================================================

export function clearActionsStore(): void {
  actionsStore.clear();
}

export function seedActionsForTesting(actions: GovernanceActionRecord[]): void {
  for (const action of actions) {
    actionsStore.set(action.id, action);
  }
}

export function getActionsStoreSize(): number {
  return actionsStore.size;
}

// ============================================================================
// Scheduled Job
// ============================================================================

export interface AutoGovernanceJobConfig {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  isRunning: boolean;
}

let jobConfig: AutoGovernanceJobConfig = {
  enabled: true,
  intervalMinutes: 15,
  lastRunAt: null,
  isRunning: false,
};

export function getJobConfig(): AutoGovernanceJobConfig {
  return { ...jobConfig };
}

export function configureJob(config: Partial<AutoGovernanceJobConfig>): void {
  jobConfig = { ...jobConfig, ...config };
}

export async function runScheduledJob(
  metricsByAsset: Map<string, AiMetricsDaily>,
  historyByAsset: Map<string, AiMetricsDaily[]>,
): Promise<ReturnType<typeof runBatchEvaluation>> {
  if (jobConfig.isRunning) {
    throw new Error("Auto governance job is already running");
  }

  if (!jobConfig.enabled) {
    throw new Error("Auto governance is disabled");
  }

  jobConfig.isRunning = true;

  try {
    const result = await runBatchEvaluation(metricsByAsset, historyByAsset);
    jobConfig.lastRunAt = new Date().toISOString();
    return result;
  } finally {
    jobConfig.isRunning = false;
  }
}
