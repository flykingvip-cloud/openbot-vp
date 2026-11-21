import type { OperationalMetrics } from "../../../gateway/agent-growth/operational-metrics-store.js";
import type { RuntimeSqlClient } from "./execution.js";

/** Persist a complete immutable snapshot; never sample skills/metrics during replay. */
export async function enqueueOperationalGrowth(
  db: RuntimeSqlClient,
  input: {
    tenantId: string;
    executionId: string;
    eventId: string;
    agentId: string;
    metrics: OperationalMetrics;
    observedAtMs: number;
    installedSkillKeys: readonly string[];
  },
): Promise<void> {
  if (
    [input.tenantId, input.executionId, input.eventId, input.agentId].some(
      (value) => !value.trim(),
    ) ||
    !Number.isFinite(input.observedAtMs) ||
    input.observedAtMs < 0
  ) {
    throw new Error("Growth event requires trusted immutable identity");
  }
  const payload = JSON.stringify({
    type: "growth.operational",
    agentId: input.agentId,
    metrics: input.metrics,
    observedAtMs: input.observedAtMs,
    installedSkillKeys: [...input.installedSkillKeys].toSorted(),
  });
  const result = await db.query(
    `INSERT INTO runtime_execution_outbox(tenant_id,event_id,execution_id,payload)
  SELECT $1,$2,$3,$4::jsonb FROM runtime_executions WHERE tenant_id=$1 AND execution_id=$3
  ON CONFLICT (tenant_id,event_id) DO UPDATE SET event_id=runtime_execution_outbox.event_id
  WHERE runtime_execution_outbox.execution_id=EXCLUDED.execution_id
    AND runtime_execution_outbox.payload=EXCLUDED.payload RETURNING event_id`,
    [input.tenantId, input.eventId, input.executionId, payload],
  );
  if (result.rows.length !== 1) {
    throw new Error("Growth execution missing or event payload conflicts");
  }
}
