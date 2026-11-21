import type { OpenBotConfig } from "../../config/config.js";
import {
  createBackgroundGrowthConsumer,
  type GrowthServiceGrant,
} from "../../gateway/agent-growth/background-consumer-authority.js";
import type { RuntimeSqlClient } from "../state/postgres/execution.js";
import { createGrowthCaptureConsumer } from "../state/postgres/growth-capture-consumer.js";
import { startRuntimeOutboxScheduler } from "../state/postgres/outbox-scheduler.js";
import { PostgresRuntimeOutbox } from "../state/postgres/outbox.js";
import { captureAuthorizedCloseoutGrowth } from "./growth-closeout-producer.js";
import { registerRuntimeLease } from "./runtime-lease-registry.js";

/** Host-owned service grant and SQL connection; no implicit environment authority. */
export async function startGrowthOutboxConsumer(input: {
  cfg: OpenBotConfig;
  tenantId: string;
  db: RuntimeSqlClient;
  authorize: () => Promise<GrowthServiceGrant>;
  onError: (error: unknown) => void;
}) {
  const grant = await input.authorize();
  if (
    !grant.principalId.trim() ||
    grant.context.tenantId !== input.tenantId ||
    !grant.context.userId.trim()
  ) {
    throw new Error("Growth consumer startup authority mismatch");
  }
  const consume = createBackgroundGrowthConsumer(input);
  const unavailable = async () => {
    throw new Error("Unregistered projection consumer");
  };
  let scheduler: ReturnType<typeof startRuntimeOutboxScheduler> | undefined;
  let unregister: (() => void) | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      try {
        await scheduler?.stop();
      } finally {
        unregister?.();
      }
    })());
  try {
    unregister = registerRuntimeLease(stop);
    scheduler = startRuntimeOutboxScheduler({
      tenantId: input.tenantId,
      store: new PostgresRuntimeOutbox(input.db, ["growth.operational", "growth.capture"]),
      ports: {
        growth: unavailable,
        statistics: unavailable,
        aor: unavailable,
        recovery: unavailable,
        growthOperational: consume,
        growthCapture: createGrowthCaptureConsumer({
          db: input.db,
          tenantId: input.tenantId,
          capture: async (agentId, executionId) => {
            const current = await input.authorize();
            return captureAuthorizedCloseoutGrowth({
              db: input.db,
              cfg: input.cfg,
              tenantId: input.tenantId,
              executionId,
              agentId,
              principalId: current.principalId,
            });
          },
        }),
      },
      onError: input.onError,
    });
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
