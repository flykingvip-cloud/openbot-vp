export interface RuntimeSqlClient {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/** Database clock owns lease validity; tenant identity must come from trusted ingress. */
export class PostgresExecutionRepository {
  constructor(private readonly db: RuntimeSqlClient) {}

  async claim(tenantId: string, executionId: string, owner: string, leaseMs: number) {
    if (!owner.trim() || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new Error("Invalid execution lease");
    }
    const result = await this.db.query(
      `UPDATE runtime_executions
      SET lease_owner=$3, lease_expires_at=clock_timestamp()+($4 * interval '1 millisecond'),
          fence=fence+1, version=version+1, state='running'
      WHERE tenant_id=$1 AND execution_id=$2 AND state IN ('ready','running','waiting')
        AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
      RETURNING fence, version`,
      [tenantId, executionId, owner, leaseMs],
    );
    return result.rows[0] ?? null;
  }

  async renew(input: {
    tenantId: string;
    executionId: string;
    owner: string;
    fence: string;
    leaseMs: number;
  }): Promise<boolean> {
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) {
      throw new Error("Invalid lease duration");
    }
    const result = await this.db.query(
      `UPDATE runtime_executions
      SET lease_expires_at=clock_timestamp()+($5 * interval '1 millisecond')
      WHERE tenant_id=$1 AND execution_id=$2 AND lease_owner=$3 AND fence=$4
      AND lease_expires_at > clock_timestamp() AND state IN ('running','waiting') RETURNING fence`,
      [input.tenantId, input.executionId, input.owner, input.fence, input.leaseMs],
    );
    return result.rows.length === 1;
  }

  /** Trusted cancellation ingress; invalidates ownership and races atomically with completion. */
  async requestCancellation(
    tenantId: string,
    executionId: string,
    eventId: string,
  ): Promise<boolean> {
    if (!tenantId.trim() || !executionId.trim() || !eventId.trim()) {
      throw new Error("Cancellation requires trusted execution identity");
    }
    const result = await this.db.query(
      `WITH changed AS (
      UPDATE runtime_executions SET state='cancelled', version=version+1, fence=fence+1,
        lease_owner=NULL, lease_expires_at=NULL
      WHERE tenant_id=$1 AND execution_id=$2 AND state IN ('ready','running','waiting')
      RETURNING tenant_id,execution_id,payload
    ), cancelled_fact AS (
      INSERT INTO runtime_task_result_facts(tenant_id,execution_id,terminal_event_id,state,evidence,agent_id)
      SELECT tenant_id,execution_id,$3,'cancelled','[]'::jsonb,payload->>'agentId' FROM changed
      RETURNING execution_id
    ) INSERT INTO runtime_execution_outbox(tenant_id,event_id,execution_id,payload)
      SELECT tenant_id,$3,execution_id,'{"state":"cancelled"}'::jsonb FROM changed RETURNING event_id`,
      [tenantId, executionId, eventId],
    );
    return result.rows.length === 1;
  }

  /** Persist a recovery handoff without inventing business completion. */
  async wait(input: {
    tenantId: string;
    executionId: string;
    owner: string;
    fence: string;
    version: string;
    eventId: string;
    reason: string;
  }): Promise<boolean> {
    if (!input.reason.trim() || !input.eventId.trim()) {
      throw new Error("Waiting requires reason and event identity");
    }
    const result = await this.db.query(
      `WITH changed AS (
      UPDATE runtime_executions SET state='waiting', version=version+1,
        lease_owner=NULL, lease_expires_at=NULL,
        payload=payload || jsonb_build_object('waitReason',$6::text)
      WHERE tenant_id=$1 AND execution_id=$2 AND lease_owner=$3 AND fence=$4 AND version=$5
        AND lease_expires_at > clock_timestamp() AND state='running'
      RETURNING tenant_id,execution_id
    ) INSERT INTO runtime_execution_outbox(tenant_id,event_id,execution_id,payload)
      SELECT tenant_id,$7,execution_id,jsonb_build_object('state','waiting','reason',$6::text)
      FROM changed RETURNING event_id`,
      [
        input.tenantId,
        input.executionId,
        input.owner,
        input.fence,
        input.version,
        input.reason,
        input.eventId,
      ],
    );
    return result.rows.length === 1;
  }

  /** Terminal transition and its event commit as one SQL statement. First terminal wins. */
  async settle(input: {
    tenantId: string;
    executionId: string;
    owner: string;
    fence: string;
    version: string;
    state: "completed" | "cancelled" | "failed";
    eventId: string;
    evidence: readonly string[];
    statisticsAgentId?: string;
    growthCapture?: boolean;
  }): Promise<boolean> {
    if (!input.eventId.trim() || (input.state === "completed" && input.evidence.length === 0)) {
      throw new Error("Terminal transition requires event identity and completion evidence");
    }
    const result = await this.db.query(
      `WITH changed AS (
      UPDATE runtime_executions SET state=$6, version=version+1,
        lease_owner=NULL, lease_expires_at=NULL
      WHERE tenant_id=$1 AND execution_id=$2 AND lease_owner=$3 AND fence=$4 AND version=$5
        AND lease_expires_at > clock_timestamp() AND state IN ('running','waiting')
      RETURNING tenant_id, execution_id
    ), result_fact AS (
      INSERT INTO runtime_task_result_facts(tenant_id,execution_id,terminal_event_id,state,evidence,agent_id)
      SELECT tenant_id,execution_id,$7,$6,$8::jsonb,$9::text FROM changed
      RETURNING execution_id
    ) INSERT INTO runtime_execution_outbox(tenant_id,event_id,execution_id,payload)
      SELECT tenant_id,$7,execution_id,$8::jsonb FROM changed
      UNION ALL
      SELECT tenant_id,$7 || ':statistics',execution_id,
        jsonb_build_object('type','statistics.outcome','agentId',$9::text,'success',true)
      FROM changed WHERE $6='completed' AND $9::text IS NOT NULL
      UNION ALL
      SELECT tenant_id,$7 || ':growth-capture',execution_id,
        jsonb_build_object('type','growth.capture','agentId',$9::text,'deliveryEvidence',$8::jsonb)
      FROM changed WHERE $6='completed' AND $9::text IS NOT NULL AND $10::boolean
      RETURNING event_id`,
      [
        input.tenantId,
        input.executionId,
        input.owner,
        input.fence,
        input.version,
        input.state,
        input.eventId,
        JSON.stringify({ state: input.state, evidence: input.evidence }),
        input.statisticsAgentId?.trim() || null,
        input.growthCapture === true,
      ],
    );
    return result.rows.some((row) => row.event_id === input.eventId);
  }
}
