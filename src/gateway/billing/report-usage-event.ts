/**
 * Canonical usage-emit path (R9): idempotently record a usage record, then — only
 * on a first (non-deduped) write — publish a `UsageReportedEvent` carrying `userId`
 * (plus optional agent/seat) so the durable event log stays a faithful per-user
 * source of truth (R9.1 / R9.4 / R18 / R21).
 *
 * Shared by `usage-ingest.report` (the public RPC) and the gated candidate-run
 * producer (Phase C1) so both emit through one path — no duplicated record+publish.
 */

import { billingEventBus } from "./event-bus.js";
import { recordUsage } from "./usage-records-store.js";

export type ReportUsageEventInput = {
  enterpriseId: string;
  userId: string;
  /** Idempotency key, unique per enterprise. */
  eventId: string;
  key: string;
  quantity: number;
  occurredAt?: string;
  agentId?: string | null;
  orgSeatId?: string | null;
};

export type ReportUsageEventResult = { recorded: boolean; deduped: boolean };

/** Records the usage row and publishes the event on first write (deduped writes don't re-publish). */
export async function reportUsageEvent(
  input: ReportUsageEventInput,
): Promise<ReportUsageEventResult> {
  const result = await recordUsage({
    enterpriseId: input.enterpriseId,
    userId: input.userId,
    eventId: input.eventId,
    key: input.key,
    quantity: input.quantity,
    ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
    ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
    ...(input.orgSeatId !== undefined ? { orgSeatId: input.orgSeatId } : {}),
  });
  // Only the first (non-duplicate) write publishes, so at-least-once delivery never
  // double-counts an already-recorded event (mirrors usage-ingest's R9.4 guard).
  if (result.recorded) {
    await billingEventBus.publish({
      type: "usage.reported",
      enterpriseId: input.enterpriseId,
      userId: result.record.userId,
      eventId: input.eventId,
      key: input.key,
      quantity: input.quantity,
      occurredAt: result.record.occurredAt,
      ...(result.record.agentId ? { agentId: result.record.agentId } : {}),
      ...(result.record.orgSeatId ? { orgSeatId: result.record.orgSeatId } : {}),
    });
  }
  return { recorded: result.recorded, deduped: result.deduped };
}
