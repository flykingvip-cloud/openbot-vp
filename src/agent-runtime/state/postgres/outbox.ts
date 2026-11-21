import { randomUUID } from "node:crypto";
import type { RuntimeSqlClient } from "./execution.js";
import type { RuntimeOutboxEvent } from "./outbox-consumer.js";
export class PostgresRuntimeOutbox {
  constructor(
    private readonly db: RuntimeSqlClient,
    private readonly eventTypes?: readonly string[],
  ) {
    if (eventTypes && (!eventTypes.length || eventTypes.some((type) => !type.trim()))) {
      throw new Error("Outbox event filter must contain registered types");
    }
  }
  async claim(tenantId: string, leaseMs = 30_000): Promise<RuntimeOutboxEvent | null> {
    if (!tenantId.trim() || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new Error("Invalid outbox claim");
    }
    const token = randomUUID();
    const result = await this.db.query(
      `WITH candidate AS (
      SELECT tenant_id,event_id FROM runtime_execution_outbox
      WHERE tenant_id=$1 AND delivered_at IS NULL
        AND ($4::text[] IS NULL OR payload->>'type'=ANY($4::text[]))
        AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp())
        AND (claim_expires_at IS NULL OR claim_expires_at<=clock_timestamp())
      ORDER BY event_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE runtime_execution_outbox e SET claim_token=$2,
      claim_expires_at=clock_timestamp()+($3 * interval '1 millisecond'),attempts=e.attempts+1
      FROM candidate c WHERE e.tenant_id=c.tenant_id AND e.event_id=c.event_id
      RETURNING e.event_id,e.execution_id,e.payload,e.claim_token,e.attempts`,
      [tenantId, token, leaseMs, this.eventTypes ? [...this.eventTypes] : null],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    if (
      typeof row.event_id !== "string" ||
      typeof row.execution_id !== "string" ||
      typeof row.claim_token !== "string"
    ) {
      throw new Error("Invalid runtime Outbox claim result");
    }
    return {
      event_id: row.event_id,
      execution_id: row.execution_id,
      claim_token: row.claim_token,
      payload: row.payload,
    };
  }
  async acknowledge(tenantId: string, eventId: string, token: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE runtime_execution_outbox SET delivered_at=clock_timestamp(),
      claim_token=NULL,claim_expires_at=NULL,last_error=NULL
      WHERE tenant_id=$1 AND event_id=$2 AND claim_token=$3 AND delivered_at IS NULL
        AND claim_expires_at>clock_timestamp() RETURNING event_id`,
      [tenantId, eventId, token],
    );
    return result.rows.length === 1;
  }
  async fail(tenantId: string, eventId: string, token: string, error: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE runtime_execution_outbox SET
      next_attempt_at=clock_timestamp()+interval '30 seconds',last_error=$4,
      claim_token=NULL,claim_expires_at=NULL
      WHERE tenant_id=$1 AND event_id=$2 AND claim_token=$3 AND delivered_at IS NULL
        AND claim_expires_at>clock_timestamp() RETURNING event_id`,
      [tenantId, eventId, token, error],
    );
    return result.rows.length === 1;
  }
}
