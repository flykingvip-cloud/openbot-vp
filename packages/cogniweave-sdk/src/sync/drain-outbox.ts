import {
  createCloudIdempotencyKey,
  createCloudNonce,
  type CloudAuthContext,
  type CloudIntelligenceClient,
} from "./cloud-client.js";
import type { SyncOutbox } from "./outbox.js";

/**
 * CW2-P5-02 async outbox drain — never await from writeBack hot path.
 */

export type DrainOutboxResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

const DEFAULT_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000];

export function nextOutboxBackoffMs(attempts: number): number {
  const idx = Math.min(Math.max(attempts - 1, 0), DEFAULT_BACKOFF_MS.length - 1);
  return DEFAULT_BACKOFF_MS[idx] ?? 30_000;
}

export async function drainOutbox(params: {
  outbox: SyncOutbox;
  client: CloudIntelligenceClient;
  auth: CloudAuthContext;
  limit?: number;
  nowMs?: number;
  maxAttempts?: number;
}): Promise<DrainOutboxResult> {
  const nowMs = params.nowMs ?? Date.now();
  const maxAttempts = params.maxAttempts ?? 8;
  const claimed = await params.outbox.claimDue(params.limit ?? 10, nowMs);
  let succeeded = 0;
  let failed = 0;

  for (const entry of claimed) {
    if (entry.attempts > maxAttempts) {
      await params.outbox.markFailed(
        entry.id,
        `max_attempts_exceeded:${entry.attempts}`,
        new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
      );
      failed += 1;
      continue;
    }

    try {
      const nonce = createCloudNonce();
      const timestampMs = nowMs;
      const idempotencyKey = createCloudIdempotencyKey({
        atomId: entry.atomId,
        operation: entry.operation,
        atomVersion: entry.atomVersion,
      });

      const result =
        entry.operation === "push"
          ? await params.client.push(
              {
                idempotencyKey,
                envelope: entry.envelope!,
                nonce,
                timestampMs,
              },
              params.auth,
            )
          : await params.client.deleteTombstone(
              {
                idempotencyKey,
                atomId: entry.atomId,
                atomVersion: entry.atomVersion,
                nonce,
                timestampMs,
              },
              params.auth,
            );

      if (result.ok) {
        await params.outbox.markDone(entry.id);
        succeeded += 1;
      } else {
        const nextAttemptAt = new Date(nowMs + nextOutboxBackoffMs(entry.attempts)).toISOString();
        await params.outbox.markFailed(entry.id, `${result.code}:${result.message}`, nextAttemptAt);
        failed += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextAttemptAt = new Date(nowMs + nextOutboxBackoffMs(entry.attempts)).toISOString();
      await params.outbox.markFailed(entry.id, message, nextAttemptAt);
      failed += 1;
    }
  }

  return {
    processed: claimed.length,
    succeeded,
    failed,
  };
}
