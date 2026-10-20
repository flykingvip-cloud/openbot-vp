import {
  listPendingRevokeOutbox,
  markRevokeOutboxStatus,
} from "../conversations/memory-recall-deny.js";
/**
 * Drain durable revoke outbox → forgetSource (plan §8.5.3).
 */
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory/revoke-outbox");

export type ForgetSourceFn = (input: {
  sourceIdentityId?: string;
  sourceLocator?: string;
  operationId: string;
  reasonCode: string;
}) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>;

/**
 * Process PENDING/FAILED revoke outbox entries.
 * For each revoked sourceIdentityId call forgetSource; mark SUCCEEDED when all ok.
 */
export async function drainRevokeOutbox(params: {
  storeDir: string;
  forgetSource: ForgetSourceFn;
  maxEntries?: number;
}): Promise<{ processed: number; succeeded: number; failed: number }> {
  const pending = await listPendingRevokeOutbox(params.storeDir);
  const limit = params.maxEntries ?? 50;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const entry of pending.slice(0, limit)) {
    processed += 1;
    const ids = entry.payload.revokedSourceIdentityIds ?? [];
    const errors: string[] = [];

    if (ids.length === 0) {
      // No sealed identities — still SUCCEEDED (deny watermark already blocks message ids).
      await markRevokeOutboxStatus({
        storeDir: params.storeDir,
        outboxId: entry.outboxId,
        status: "SUCCEEDED",
      });
      succeeded += 1;
      continue;
    }

    for (const sourceIdentityId of ids) {
      try {
        const result = await params.forgetSource({
          sourceIdentityId,
          operationId: `revoke-outbox-${entry.outboxId}-${sourceIdentityId.slice(0, 12)}`,
          reasonCode: "TRANSCRIPT_RANGE_REVOKED",
        });
        if (!result.ok && !result.skipped) {
          errors.push(result.error ?? sourceIdentityId);
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (errors.length === 0) {
      await markRevokeOutboxStatus({
        storeDir: params.storeDir,
        outboxId: entry.outboxId,
        status: "SUCCEEDED",
      });
      succeeded += 1;
    } else {
      await markRevokeOutboxStatus({
        storeDir: params.storeDir,
        outboxId: entry.outboxId,
        status: "FAILED",
        lastError: errors.join("; ").slice(0, 500),
      });
      failed += 1;
      log.warn(`revoke outbox failed outboxId=${entry.outboxId}: ${errors.join("; ")}`);
    }
  }

  return { processed, succeeded, failed };
}
