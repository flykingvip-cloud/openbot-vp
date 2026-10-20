/**
 * Drain pending usage outbox records via idempotent recordCreditUsage.
 */

import { settleCreditReservation } from "./credit-reservation-store.js";
import { recordCreditUsage, type RecordCreditUsageResult } from "./record-credit-usage.js";
import {
  listUsageOutboxDue,
  markUsageOutboxDone,
  markUsageOutboxFailed,
  markUsageOutboxProcessing,
  type UsageOutboxRecord,
} from "./usage-outbox-store.js";

export type DrainUsageOutboxResult = {
  attempted: number;
  succeeded: number;
  failed: number;
};

async function settleReservationAfterUsage(
  payload: UsageOutboxRecord["payload"],
  usage: RecordCreditUsageResult,
): Promise<void> {
  const runId = payload.runId?.trim() || payload.taskId.trim();
  if (!runId) {
    return;
  }
  await settleCreditReservation({
    runId,
    actualCredits: usage.creditsCharged,
    storePath: payload.storePaths?.creditReservations,
  }).catch(() => undefined);
}

export async function drainUsageOutbox(params?: {
  storePath?: string;
  limit?: number;
}): Promise<DrainUsageOutboxResult> {
  const due = await listUsageOutboxDue({
    storePath: params?.storePath,
    limit: params?.limit ?? 25,
  });
  let succeeded = 0;
  let failed = 0;
  for (const record of due) {
    const claimed = await markUsageOutboxProcessing(record.id, params?.storePath);
    if (!claimed || claimed.status === "done") {
      continue;
    }
    try {
      const usage = await recordCreditUsage(claimed.payload);
      await markUsageOutboxDone(record.id, params?.storePath);
      await settleReservationAfterUsage(claimed.payload, usage);
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markUsageOutboxFailed({
        id: record.id,
        error: message,
        storePath: params?.storePath,
      });
      failed += 1;
    }
  }
  return { attempted: due.length, succeeded, failed };
}

/** Process a single known record; returns usage result for callers to settle holds. */
export async function drainUsageOutboxRecord(
  record: UsageOutboxRecord,
  storePath?: string,
): Promise<RecordCreditUsageResult> {
  await markUsageOutboxProcessing(record.id, storePath);
  try {
    const usage = await recordCreditUsage(record.payload);
    await markUsageOutboxDone(record.id, storePath);
    await settleReservationAfterUsage(record.payload, usage);
    return usage;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markUsageOutboxFailed({ id: record.id, error: message, storePath });
    throw error;
  }
}
