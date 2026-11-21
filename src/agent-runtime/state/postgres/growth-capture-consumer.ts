import type { OperationalMetrics } from "../../../gateway/agent-growth/operational-metrics-store.js";
import type { RuntimeSqlClient } from "./execution.js";
import { enqueueOperationalGrowth } from "./growth-event-producer.js";
export type AuthorizedGrowthSnapshot = {
  metrics: OperationalMetrics;
  observedAtMs: number;
  installedSkillKeys: readonly string[];
};

/** Caller supplies authorized snapshot source; never falls back to global skills. */
export function createGrowthCaptureConsumer(input: {
  db: RuntimeSqlClient;
  tenantId: string;
  capture: (agentId: string, executionId: string) => Promise<AuthorizedGrowthSnapshot>;
}) {
  return async (eventId: string, executionId: string, agentId: string): Promise<void> => {
    const downstreamId = `${eventId}:operational`;
    // A retry after publish-before-ack must not resample a newer mutable source.
    const prior = await input.db.query(
      `SELECT payload FROM runtime_execution_outbox
    WHERE tenant_id=$1 AND event_id=$2 AND execution_id=$3`,
      [input.tenantId, downstreamId, executionId],
    );
    if (prior.rows.length) {
      const payload = prior.rows[0].payload as Record<string, unknown>;
      if (payload?.type !== "growth.operational" || payload.agentId !== agentId) {
        throw new Error("Growth capture publication identity conflict");
      }
      return;
    }
    const snapshot = await input.capture(agentId, executionId);
    await enqueueOperationalGrowth(input.db, {
      tenantId: input.tenantId,
      executionId,
      eventId: downstreamId,
      agentId,
      ...snapshot,
    });
  };
}
