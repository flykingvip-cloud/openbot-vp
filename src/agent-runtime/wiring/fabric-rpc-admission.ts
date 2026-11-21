import { createRequire } from "node:module";
import type { ToolRequest } from "../../fabric/contract.js";
import {
  RUNTIME_PG_OPTIONS,
  RUNTIME_SHUTDOWN_MS,
  withRuntimeDeadline,
} from "../state/postgres/deadline.js";
/** Called only after RPC membership authorization. Does not grant tool permissions. */
export async function persistAuthorizedFabricRequest(request: ToolRequest): Promise<void> {
  const url = process.env.OPENBOT_RUNTIME_DATABASE_URL?.trim();
  if (!url) {
    return;
  }
  const { tenantId, userId } = request.source;
  const taskId = request.trace.taskId;
  if (!tenantId || !userId || !taskId) {
    throw new Error("Database Fabric requires authenticated tenant/user and task identity");
  }
  const { Pool } = createRequire(import.meta.url)("pg");
  const db = new Pool({ connectionString: url, ...RUNTIME_PG_OPTIONS });
  const executionId = `fabric:${request.trace.correlationId}`;
  const payload = JSON.stringify({
    taskId,
    userId,
    sessionKey: request.trace.sessionId,
    ingress: "fabric",
    request,
  });
  try {
    const result = await db.query(
      `INSERT INTO runtime_executions(tenant_id,execution_id,state,payload)
   SELECT $1,$2,'ready',$3::jsonb FROM runtime_executions authorized_task
   WHERE authorized_task.tenant_id=$1
     AND authorized_task.payload->>'taskId'=$4
     AND authorized_task.payload->>'userId'=$5
     AND authorized_task.payload->>'sessionKey'=$6
     AND authorized_task.payload->>'ingress'<>'fabric'
     AND authorized_task.state IN ('ready','running','waiting')
   LIMIT 1
   ON CONFLICT (tenant_id,execution_id) DO UPDATE
   SET execution_id=runtime_executions.execution_id WHERE runtime_executions.payload=EXCLUDED.payload RETURNING execution_id`,
      [tenantId, executionId, payload, taskId, userId, request.trace.sessionId],
    );
    if (result.rows.length !== 1) {
      throw new Error(
        "Fabric task authority missing or logical execution conflicts with persisted request",
      );
    }
  } finally {
    await withRuntimeDeadline(db.end(), RUNTIME_SHUTDOWN_MS, "Fabric admission pool shutdown");
  }
}
