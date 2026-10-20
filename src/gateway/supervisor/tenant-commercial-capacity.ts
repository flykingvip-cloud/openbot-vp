/**
 * Supervisor / Workflow 租户级商业容量聚合（Wave 6）。
 *
 * 多 task 并行时，将 supervisor in-flight 任务与 agent-run 注册表并发一并计入。
 */

import { countActiveAgentRuns } from "../billing/agent-run-registry.js";
import { getActiveSubscriptionRuntimeSnapshot } from "../billing/subscription-runtime-snapshots-store.js";
import { getActiveSubscription } from "../billing/subscriptions-store.js";
import { isInFlightTaskState } from "./engine.js";
import { listActiveTasks } from "./store.js";

export type SupervisorTenantCommercialCapacity = {
  enterpriseId: string;
  activeSupervisorTasks: number;
  inFlightSupervisorTasks: number;
  activeCommercialRuns: number;
  combinedConcurrentUsage: number;
  maxConcurrentRuns: number | null;
  totalSupervisorSpentCostUsd: number;
  allowed: boolean;
  reason?: string;
};

export async function resolveSupervisorTenantCommercialCapacity(
  enterpriseId: string,
  opts?: {
    agentRunRegistry?: string;
    runtimeSnapshots?: string;
    subscriptions?: string;
    supervisorStoreDir?: string;
  },
): Promise<SupervisorTenantCommercialCapacity> {
  const tasks = await listActiveTasks(opts?.supervisorStoreDir);
  const tenantTasks = tasks.filter((task) => task.tenantId === enterpriseId);
  const inFlightSupervisorTasks = tenantTasks.filter((task) =>
    isInFlightTaskState(task.state),
  ).length;
  const totalSupervisorSpentCostUsd = tenantTasks.reduce(
    (sum, task) => sum + (task.budget.spentCostUsd ?? 0),
    0,
  );
  const activeCommercialRuns = await countActiveAgentRuns(enterpriseId, opts?.agentRunRegistry);
  const combinedConcurrentUsage = inFlightSupervisorTasks + activeCommercialRuns;

  const subscription = await getActiveSubscription(enterpriseId, opts?.subscriptions);
  const runtimeSnapshot = subscription
    ? await getActiveSubscriptionRuntimeSnapshot(enterpriseId, opts?.runtimeSnapshots)
    : null;
  const maxConcurrentRuns = runtimeSnapshot?.entitlementSnapshot.maxConcurrentRuns ?? null;

  let allowed = true;
  let reason: string | undefined;
  if (
    maxConcurrentRuns != null &&
    maxConcurrentRuns > 0 &&
    combinedConcurrentUsage >= maxConcurrentRuns
  ) {
    allowed = false;
    reason = `租户 AI 同时工作能力已满（${combinedConcurrentUsage}/${maxConcurrentRuns}，含 ${inFlightSupervisorTasks} 个监督任务）`;
  }

  return {
    enterpriseId,
    activeSupervisorTasks: tenantTasks.length,
    inFlightSupervisorTasks,
    activeCommercialRuns,
    combinedConcurrentUsage,
    maxConcurrentRuns,
    totalSupervisorSpentCostUsd,
    allowed,
    reason,
  };
}
