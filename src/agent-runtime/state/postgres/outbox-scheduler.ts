import { resolveRuntimeEventHandler, type RuntimeProjectionPorts } from "./event-handlers.js";
import { drainRuntimeOutbox, type RuntimeOutboxConsumerStore } from "./outbox-consumer.js";

/** One in-process drain at a time; cross-process ownership stays in PostgreSQL. */
export function startRuntimeOutboxScheduler(input: {
  tenantId: string;
  store: RuntimeOutboxConsumerStore;
  ports: RuntimeProjectionPorts;
  intervalMs?: number;
  onError: (error: unknown) => void;
}) {
  const intervalMs = input.intervalMs ?? 5000;
  if (!input.tenantId.trim() || !Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error("Invalid runtime scheduler scope");
  }
  const controller = new AbortController();
  let stopped = false;
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (stopped || pending) {
      return;
    }
    pending = drainRuntimeOutbox({
      tenantId: input.tenantId,
      store: input.store,
      signal: controller.signal,
      resolveHandler: (event) => resolveRuntimeEventHandler(input.ports, event),
    })
      .then(() => undefined)
      .catch((error) => {
        if (!stopped) {
          input.onError(error);
        }
      })
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      controller.abort(new Error("Runtime Outbox scheduler stopping"));
      await pending;
    },
  };
}
