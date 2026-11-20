import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type {
  AgentRunLoopResult,
  AgentTurnExecutionParams,
} from "../execution/runner/turn-contract.js";
import { PostgresExecutionRepository } from "../state/postgres/execution.js";
import { acquireExecutionLease } from "../state/postgres/lease-lifecycle.js";
import { registerRuntimeLease } from "./runtime-lease-registry.js";

type Pool = {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end(): Promise<void>;
};

/** Opt-in lease admission. Table provisioning is a separate operator migration. */
export async function runWithPostgresTurnLease(
  request: AgentTurnExecutionParams,
  run: (request: AgentTurnExecutionParams) => Promise<AgentRunLoopResult>,
  createPool?: (url: string) => Pool,
): Promise<AgentRunLoopResult> {
  const url = process.env.OPENBOT_RUNTIME_DATABASE_URL?.trim();
  if (!url) {
    return run(request);
  }
  const identity = request.followupRun.run.executionIdentity;
  const tenantId =
    identity?.enterpriseId?.trim() || identity?.collaborationOwnerEntitlement?.tenantId?.trim();
  const binding = request.followupRun.run.taskCompletionBinding;
  // Never synthesize a durable identity from prompt text or a random per-retry id.
  const executionId = binding?.executionAttempt?.trim();
  if (!tenantId || !executionId || !binding?.taskId) {
    throw new Error(
      "Postgres runtime requires trusted tenant and stable admitted execution identity",
    );
  }
  request.opts?.abortSignal?.throwIfAborted();
  const require = createRequire(import.meta.url);
  const { Pool } = require("pg") as {
    Pool: new (options: { connectionString: string; max: number }) => Pool;
  };
  const db = createPool ? createPool(url) : new Pool({ connectionString: url, max: 2 });
  let lease: Awaited<ReturnType<typeof acquireExecutionLease>> | undefined;
  const repository = new PostgresExecutionRepository(db);
  const owner = randomUUID();
  let handedOff = false;
  let closed = false;
  let unregister: (() => void) | undefined;
  const cleanup = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await lease?.dispose();
    try {
      await db.end();
    } finally {
      unregister?.();
    }
  };
  try {
    unregister = registerRuntimeLease(cleanup);
    await db.query(
      `INSERT INTO runtime_executions(tenant_id,execution_id,state,payload)
      VALUES ($1,$2,'ready',$3::jsonb) ON CONFLICT (tenant_id,execution_id) DO NOTHING`,
      [tenantId, executionId, JSON.stringify({ taskId: binding.taskId })],
    );
    lease = await acquireExecutionLease({
      repository,
      tenantId,
      executionId,
      owner,
      parentSignal: request.opts?.abortSignal,
    });
    lease.signal.throwIfAborted();
    const result = await run({ ...request, opts: { ...request.opts, abortSignal: lease.signal } });
    lease.signal.throwIfAborted();
    if (result.kind !== "success") {
      return result;
    }
    const activeLease = lease;
    const originalCommit = result.commitGrowthOutcome;
    let committed = false;
    // Ownership continues through the existing deferred outcome/acceptance callback.
    handedOff = true;
    return {
      ...result,
      commitGrowthOutcome: async (success, options) => {
        if (committed) {
          return;
        }
        committed = true;
        try {
          activeLease.signal.throwIfAborted();
          const accepted = options?.acceptance?.status === "passed";
          const delivered = options?.delivery?.status === "delivered";
          if (
            success &&
            accepted &&
            delivered &&
            options?.deliveryId &&
            !options.processPlaceholder
          ) {
            const settled = await repository.settle({
              tenantId,
              executionId,
              owner,
              fence: activeLease.fence,
              version: activeLease.version,
              state: "completed",
              eventId: `completion:${executionId}`,
              evidence: [options.deliveryId],
            });
            if (!settled) {
              throw new Error("Execution ownership lost before acceptance commit");
            }
          }
          await originalCommit(success, options);
        } finally {
          await cleanup();
        }
      },
    };
  } finally {
    if (!handedOff) {
      await cleanup();
    }
  }
}
