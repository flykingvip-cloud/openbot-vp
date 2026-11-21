import type { RuntimeSqlClient } from "./execution.js";

/** Immutable source facts for deterministic projection rebuild, not a file-store effect receipt. */
export class PostgresProjectionReceipts {
  constructor(private readonly db: RuntimeSqlClient) {}
  async append(input: {
    tenantId: string;
    consumer: "growth" | "statistics" | "aor";
    eventId: string;
    executionId: string;
    payload: Record<string, unknown>;
  }): Promise<"inserted" | "duplicate"> {
    const { tenantId, consumer, eventId, executionId, payload } = input;
    if ([tenantId, eventId, executionId].some((value) => !value.trim())) {
      throw new Error("Projection receipt requires trusted identity");
    }
    const result = await this.db.query(
      `INSERT INTO runtime_projection_receipts
      (tenant_id,consumer,event_id,execution_id,payload) VALUES ($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT (tenant_id,consumer,event_id) DO UPDATE
      SET event_id=runtime_projection_receipts.event_id
      WHERE runtime_projection_receipts.execution_id=EXCLUDED.execution_id
        AND runtime_projection_receipts.payload=EXCLUDED.payload
      RETURNING (xmax=0) AS inserted`,
      [tenantId, consumer, eventId, executionId, JSON.stringify(payload)],
    );
    if (result.rows.length !== 1) {
      throw new Error("Projection event conflicts with persisted receipt");
    }
    return result.rows[0].inserted === true ? "inserted" : "duplicate";
  }
}
