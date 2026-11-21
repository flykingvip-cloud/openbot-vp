import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { ToolRequest } from "../../fabric/contract.js";
import type { FabricRequestHost } from "../../fabric/request-execution-host.js";
import type { FabricService } from "../../fabric/service.js";
import {
  RUNTIME_PG_OPTIONS,
  RUNTIME_SHUTDOWN_MS,
  withRuntimeDeadline,
} from "../state/postgres/deadline.js";
import { PostgresExecutionRepository } from "../state/postgres/execution.js";
import { acquireExecutionLease } from "../state/postgres/lease-lifecycle.js";
import { createFabricGrantIssuer } from "./fabric-grant-issuer.js";
import { registerRuntimeLease } from "./runtime-lease-registry.js";

/** Admission only consumes an existing host-provisioned execution, never request-created authority. */
export function createFabricRequestAdmission(input: {
  build: (
    request: ToolRequest,
    issuer: ReturnType<typeof createFabricGrantIssuer>,
  ) => FabricService;
}) {
  return async (request: ToolRequest): Promise<FabricRequestHost> => {
    const url = process.env.OPENBOT_RUNTIME_DATABASE_URL?.trim();
    const tenantId = request.source.tenantId,
      userId = request.source.userId,
      taskId = request.trace.taskId;
    const executionId = `fabric:${request.trace.correlationId}`;
    if (!url || !tenantId || !userId || !taskId) {
      throw new Error("Fabric requires trusted tenant/user/task and configured runtime database");
    }
    const { Pool } = createRequire(import.meta.url)("pg");
    const db = new Pool({ connectionString: url, ...RUNTIME_PG_OPTIONS });
    let lease: Awaited<ReturnType<typeof acquireExecutionLease>> | undefined;
    let unregister: (() => void) | undefined;
    let closing: Promise<void> | undefined;
    const dispose = () =>
      (closing ??= (async () => {
        try {
          await lease?.dispose();
        } finally {
          try {
            await withRuntimeDeadline(db.end(), RUNTIME_SHUTDOWN_MS, "Fabric pool shutdown");
          } finally {
            unregister?.();
          }
        }
      })());
    try {
      unregister = registerRuntimeLease(dispose);
      const admitted = await db.query(
        `SELECT execution_id FROM runtime_executions WHERE tenant_id=$1 AND execution_id=$2
    AND payload->>'taskId'=$3 AND payload->>'userId'=$4 AND payload->>'sessionKey'=$5
    AND payload->>'ingress'='fabric' AND payload->'request'=$6::jsonb`,
        [tenantId, executionId, taskId, userId, request.trace.sessionId, JSON.stringify(request)],
      );
      if (admitted.rows.length !== 1) {
        throw new Error("Fabric execution has no matching persisted admission");
      }
      const owner = randomUUID();
      lease = await acquireExecutionLease({
        repository: new PostgresExecutionRepository(db),
        tenantId,
        executionId,
        owner,
      });
      const issuer = createFabricGrantIssuer({
        db,
        tenantId,
        taskId,
        executionId,
        owner,
        fence: lease.fence,
        sessionKey: request.trace.sessionId,
        signal: lease.signal,
      });
      return { service: input.build(request, issuer), signal: lease.signal, dispose };
    } catch (error) {
      await dispose();
      throw error;
    }
  };
}
