import { createRequire } from "node:module";
import type { OpenBotConfig } from "../../config/config.js";
import { startInvocationAuditRecovery } from "../../gateway/skill-invocation/audit-recovery-scheduler.js";
import {
  withRuntimeDeadline,
  RUNTIME_PG_OPTIONS,
  RUNTIME_SHUTDOWN_MS,
} from "../state/postgres/deadline.js";
import type { RuntimeSqlClient } from "../state/postgres/execution.js";
import { createGrowthServiceAuthorizer } from "../state/postgres/growth-service-authority.js";
import { startGrowthOutboxConsumer } from "./growth-outbox-consumer.js";
import { registerRuntimeLease } from "./runtime-lease-registry.js";

export async function startPostgresGrowthService(input: {
  cfg: OpenBotConfig;
  onError: (error: unknown) => void;
  createPool?: (url: string) => RuntimeSqlClient & { end(): Promise<void> };
}): Promise<void> {
  if (process.env.OPENBOT_RUNTIME_GROWTH_CONSUMER !== "1") {
    return;
  }
  const url = process.env.OPENBOT_RUNTIME_DATABASE_URL?.trim();
  const tenantId = process.env.OPENBOT_RUNTIME_CONSUMER_TENANT_ID?.trim();
  const principalId = process.env.OPENBOT_RUNTIME_GROWTH_PRINCIPAL_ID?.trim();
  if (!url || !tenantId || !principalId) {
    throw new Error("Growth service requires database, tenant and registered principal");
  }
  const { Pool } = createRequire(import.meta.url)("pg");
  const db = input.createPool
    ? input.createPool(url)
    : new Pool({ connectionString: url, ...RUNTIME_PG_OPTIONS });
  let consumer: Awaited<ReturnType<typeof startGrowthOutboxConsumer>> | undefined;
  let audit: ReturnType<typeof startInvocationAuditRecovery> | undefined;
  let unregister: (() => void) | undefined;
  let stopping: Promise<void> | undefined;
  const cleanup = () =>
    (stopping ??= (async () => {
      try {
        const results = await Promise.allSettled([
          withRuntimeDeadline(
            audit?.stop() ?? Promise.resolve(),
            RUNTIME_SHUTDOWN_MS,
            "Audit recovery shutdown",
          ),
          withRuntimeDeadline(
            consumer?.stop() ?? Promise.resolve(),
            RUNTIME_SHUTDOWN_MS,
            "Growth consumer shutdown",
          ),
        ]);
        const errors = results.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (errors.length) {
          throw new AggregateError(
            errors.map((result) => result.reason),
            "Growth service cleanup failed",
          );
        }
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
    consumer = await startGrowthOutboxConsumer({
      cfg: input.cfg,
      tenantId,
      db,
      authorize: createGrowthServiceAuthorizer(db, tenantId, principalId),
      onError: input.onError,
    });
    if (process.env.OPENBOT_RUNTIME_SKILL_AUDIT_RECOVERY === "1") {
      audit = startInvocationAuditRecovery({
        tenantId,
        authorize: createGrowthServiceAuthorizer(db, tenantId, principalId),
        onError: input.onError,
      });
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
}
