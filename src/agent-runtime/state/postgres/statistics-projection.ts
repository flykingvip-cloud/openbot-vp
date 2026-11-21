import type { RuntimeSqlClient } from "./execution.js";

/** Counter mutation and receipt commit in one statement; replay cannot increment twice. */
export class PostgresStatisticsProjection {
  constructor(private readonly db: RuntimeSqlClient) {}
  async apply(input: {
    tenantId: string;
    agentId: string;
    eventId: string;
    executionId: string;
    success: boolean;
  }): Promise<void> {
    if ([input.tenantId, input.agentId, input.eventId, input.executionId].some((v) => !v.trim())) {
      throw new Error("Statistics requires trusted event identity");
    }
    const payload = JSON.stringify({ agentId: input.agentId, success: input.success });
    const result = await this.db.query(
      `WITH receipt AS (
      INSERT INTO runtime_projection_receipts(tenant_id,consumer,event_id,execution_id,payload)
      VALUES ($1,'statistics',$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING event_id
    ), projected AS (
      INSERT INTO runtime_statistics_projection(tenant_id,agent_id,tasks_total,tasks_succeeded)
      SELECT $1,$2,1,CASE WHEN $6 THEN 1 ELSE 0 END FROM receipt
      ON CONFLICT (tenant_id,agent_id) DO UPDATE
      SET tasks_total=runtime_statistics_projection.tasks_total+1,
          tasks_succeeded=runtime_statistics_projection.tasks_succeeded+EXCLUDED.tasks_succeeded
      RETURNING agent_id
    ) SELECT EXISTS(SELECT 1 FROM receipt) AS applied,
      EXISTS(SELECT 1 FROM runtime_projection_receipts WHERE tenant_id=$1 AND consumer='statistics'
        AND event_id=$3 AND execution_id=$4 AND payload=$5::jsonb) AS duplicate`,
      [input.tenantId, input.agentId, input.eventId, input.executionId, payload, input.success],
    );
    if (result.rows[0]?.applied !== true && result.rows[0]?.duplicate !== true) {
      throw new Error("Statistics event conflicts with receipt");
    }
  }
}

/** Tenant is bound by the host, never accepted from event payload. */
export function createStatisticsOutcomeHandler(db: RuntimeSqlClient, tenantId: string) {
  if (!tenantId.trim()) {
    throw new Error("Statistics consumer requires trusted tenant");
  }
  const projection = new PostgresStatisticsProjection(db);
  return async (
    eventId: string,
    executionId: string,
    agentId: string,
    success: boolean,
  ): Promise<void> => {
    await projection.apply({ tenantId, eventId, executionId, agentId, success });
  };
}
