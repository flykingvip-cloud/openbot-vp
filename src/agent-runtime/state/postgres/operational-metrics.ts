import type { OperationalMetrics } from "../../../gateway/agent-growth/operational-metrics-store.js";
import type { RuntimeSqlClient } from "./execution.js";

/** Rebuild accepted terminal-task observations; absent other evidence contributes no denominator. */
export async function rebuildOperationalMetrics(
  db: RuntimeSqlClient,
  scope: { tenantId: string; agentId: string },
): Promise<OperationalMetrics> {
  if (!scope.tenantId.trim() || !scope.agentId.trim()) {
    throw new Error("Metrics rebuild requires trusted scope");
  }
  const result = await db.query(
    `SELECT count(*) FILTER (WHERE state IN ('completed','failed'))::text AS tasks_total,
  count(*) FILTER (WHERE state='completed')::text AS tasks_succeeded,
  COALESCE(floor(extract(epoch FROM max(committed_at))*1000),0)::text AS observed_at
  FROM runtime_task_result_facts WHERE tenant_id=$1 AND agent_id=$2`,
    [scope.tenantId, scope.agentId],
  );
  const row = result.rows[0];
  const read = (key: string) => {
    const value = Number(row?.[key]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Invalid persisted operational aggregate");
    }
    return value;
  };
  return {
    tasksTotal: read("tasks_total"),
    tasksSucceeded: read("tasks_succeeded"),
    updatedAtMs: read("observed_at"),
    toolsTotal: 0,
    toolsSucceeded: 0,
    humanTakeovers: 0,
    takeoverObservations: 0,
    satisfactionPositive: 0,
    satisfactionNegative: 0,
    satisfactionRated: 0,
  };
}
