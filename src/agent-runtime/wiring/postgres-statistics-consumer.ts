import { createRequire } from "node:module";
import {
  withRuntimeDeadline,
  RUNTIME_PG_OPTIONS,
  RUNTIME_SHUTDOWN_MS,
} from "../state/postgres/deadline.js";
import type { RuntimeSqlClient } from "../state/postgres/execution.js";
import { startRuntimeOutboxScheduler } from "../state/postgres/outbox-scheduler.js";
import { PostgresRuntimeOutbox } from "../state/postgres/outbox.js";
import { createStatisticsOutcomeHandler } from "../state/postgres/statistics-projection.js";
import { registerRuntimeLease } from "./runtime-lease-registry.js";

/** Explicit single-tenant worker scope. Unsupported event types remain unclaimed. */
export function startPostgresStatisticsConsumer(
  onError: (error: unknown) => void,
  createPool?: (url: string) => RuntimeSqlClient & { end(): Promise<void> },
): void {
  if (process.env.OPENBOT_RUNTIME_STATISTICS_CONSUMER !== "1") {
    return;
  }
  const url = process.env.OPENBOT_RUNTIME_DATABASE_URL?.trim();
  const tenant = process.env.OPENBOT_RUNTIME_CONSUMER_TENANT_ID?.trim();
  if (!url || !tenant) {
    throw new Error("Statistics consumer requires database and trusted tenant scope");
  }
  const { Pool } = createRequire(import.meta.url)("pg");
  const db = createPool
    ? createPool(url)
    : new Pool({ connectionString: url, ...RUNTIME_PG_OPTIONS });
  const unavailable = async () => {
    throw new Error("Projection consumer is not registered");
  };
  let scheduler: ReturnType<typeof startRuntimeOutboxScheduler> | undefined;
  let unregister: (() => void) | undefined;
  let stopping: Promise<void> | undefined;
  const cleanup = () =>
    (stopping ??= (async () => {
      try {
        await withRuntimeDeadline(
          scheduler?.stop() ?? Promise.resolve(),
          RUNTIME_SHUTDOWN_MS,
          "Statistics scheduler shutdown",
        );
      } finally {
        try {
          await withRuntimeDeadline(db.end(), RUNTIME_SHUTDOWN_MS, "Postgres pool shutdown");
        } finally {
          unregister?.();
        }
      }
    })());
  try {
    unregister = registerRuntimeLease(cleanup);
    scheduler = startRuntimeOutboxScheduler({
      tenantId: tenant,
      store: new PostgresRuntimeOutbox(db, ["statistics.outcome"]),
      ports: {
        growth: unavailable,
        statistics: unavailable,
        aor: unavailable,
        recovery: unavailable,
        statisticsOutcome: createStatisticsOutcomeHandler(db, tenant),
      },
      onError,
    });
  } catch (error) {
    void cleanup().catch(onError);
    throw error;
  }
}
