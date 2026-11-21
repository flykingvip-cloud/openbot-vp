export type RuntimeOutboxEvent = {
  event_id: string;
  execution_id: string;
  payload: unknown;
  claim_token: string;
};
export type RuntimeOutboxConsumerStore = {
  claim(tenantId: string): Promise<RuntimeOutboxEvent | null>;
  acknowledge(tenantId: string, eventId: string, token: string): Promise<boolean>;
  fail(tenantId: string, eventId: string, token: string, error: string): Promise<boolean>;
};
/** Handlers must be replay-safe: a crash after effect, before ack causes redelivery. */
export async function drainRuntimeOutbox(input: {
  tenantId: string;
  store: RuntimeOutboxConsumerStore;
  resolveHandler: (
    event: RuntimeOutboxEvent,
  ) => ((event: RuntimeOutboxEvent) => Promise<void>) | undefined;
  signal?: AbortSignal;
  limit?: number;
}) {
  const counts = { claimed: 0, acknowledged: 0, failed: 0, lost: 0 };
  const limit = input.limit ?? 25;
  if (!input.tenantId.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Invalid Outbox drain scope");
  }
  for (let i = 0; i < limit; i++) {
    input.signal?.throwIfAborted();
    const event = await input.store.claim(input.tenantId);
    if (!event) {
      break;
    }
    counts.claimed++;
    try {
      input.signal?.throwIfAborted();
      const handler = input.resolveHandler(event);
      if (!handler) {
        throw new Error("No registered runtime event consumer");
      }
      await handler(event);
      input.signal?.throwIfAborted();
      if (await input.store.acknowledge(input.tenantId, event.event_id, event.claim_token)) {
        counts.acknowledged++;
      } else {
        counts.lost++;
      }
    } catch (error) {
      const failed = await input.store.fail(
        input.tenantId,
        event.event_id,
        event.claim_token,
        error instanceof Error ? error.message : String(error),
      );
      if (failed) {
        counts.failed++;
      } else {
        counts.lost++;
      }
      if (input.signal?.aborted) {
        throw error;
      }
    }
  }
  return counts;
}
