import { withFileLock, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../infra/file-lock.js";
import { createAsyncLock } from "../../infra/json-files.js";
import { resolveUserPath } from "../../utils.js";
import { settleCreditReservation } from "./credit-reservation-store.js";
/**
 * Drain pending usage outbox records via idempotent recordCreditUsage.
 */
import { recordCreditUsage, type RecordCreditUsageResult } from "./record-credit-usage.js";
import { resolveDefaultUsageOutboxStorePath } from "./usage-outbox-store.js";
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

async function drainUsageOutboxUnlocked(params?: {
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
async function drainUsageOutboxRecordUnlocked(
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

const serializeDrain = createAsyncLock();
function withUsageDeliveryLock<T>(
  storePath: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const file = resolveUserPath(storePath?.trim() || resolveDefaultUsageOutboxStorePath());
  return serializeDrain(() =>
    withFileLock(`${file}.delivery`, SESSION_TASK_BOARD_LOCK_OPTIONS, work),
  );
}
export async function drainUsageOutbox(params?: {
  storePath?: string;
  limit?: number;
}): Promise<DrainUsageOutboxResult> {
  return withUsageDeliveryLock(params?.storePath, () => drainUsageOutboxUnlocked(params));
}
export async function drainUsageOutboxRecord(
  record: UsageOutboxRecord,
  storePath?: string,
): Promise<RecordCreditUsageResult> {
  return withUsageDeliveryLock(storePath, () => drainUsageOutboxRecordUnlocked(record, storePath));
}
