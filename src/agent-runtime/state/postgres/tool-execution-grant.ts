import { createHash, randomBytes } from "node:crypto";
import type { OperationIdentity } from "../../contracts/operation.js";
import { executionOperationKey } from "../../contracts/operation.js";
import type { RuntimeSqlClient } from "./execution.js";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export type ToolGrantBinding = {
  identity: OperationIdentity;
  toolName: string;
  sessionKey: string;
  requestDigest: string;
  owner: string;
  fence: string;
};
/** Issue only for an existing current lease whose task binding matches trusted admission. */
export async function issueToolExecutionGrant(
  db: RuntimeSqlClient,
  binding: ToolGrantBinding,
): Promise<string> {
  executionOperationKey(binding.identity);
  if (
    [
      binding.toolName,
      binding.sessionKey,
      binding.requestDigest,
      binding.owner,
      binding.fence,
    ].some((value) => !value.trim())
  ) {
    throw new Error("Incomplete tool grant binding");
  }
  const token = randomBytes(32).toString("base64url");
  const result = await db.query(
    `INSERT INTO runtime_tool_execution_grants
  (token_hash,tenant_id,execution_id,task_id,step_id,operation_id,tool_name,session_key,request_digest,lease_owner,fence,expires_at)
  SELECT $1,tenant_id,execution_id,$4,$5,$6,$7,$8,$9,lease_owner,fence,LEAST(lease_expires_at,clock_timestamp()+interval '30 seconds')
  FROM runtime_executions WHERE tenant_id=$2 AND execution_id=$3 AND payload->>'taskId'=$4
    AND lease_owner=$10 AND fence=$11 AND lease_expires_at>clock_timestamp() AND state='running'
  RETURNING token_hash`,
    [
      hash(token),
      binding.identity.tenantId,
      binding.identity.executionId,
      binding.identity.taskId,
      binding.identity.stepId,
      binding.identity.operationId,
      binding.toolName,
      binding.sessionKey,
      binding.requestDigest,
      binding.owner,
      binding.fence,
    ],
  );
  if (result.rows.length !== 1) {
    throw new Error("Execution ownership unavailable for tool grant");
  }
  return token;
}
/** Recheck before invocation and before accepting its result; expired owners cannot commit. */
export async function validateToolExecutionGrant(
  db: RuntimeSqlClient,
  token: string,
  binding: Omit<ToolGrantBinding, "owner" | "fence">,
): Promise<boolean> {
  executionOperationKey(binding.identity);
  const result = await db.query(
    `SELECT g.token_hash FROM runtime_tool_execution_grants g
  JOIN runtime_executions e ON e.tenant_id=g.tenant_id AND e.execution_id=g.execution_id
  WHERE g.token_hash=$1 AND g.tenant_id=$2 AND g.execution_id=$3 AND g.task_id=$4
    AND g.step_id=$5 AND g.operation_id=$6 AND g.tool_name=$7 AND g.session_key=$8 AND g.request_digest=$9
    AND g.expires_at>clock_timestamp() AND e.lease_expires_at>clock_timestamp()
    AND e.lease_owner=g.lease_owner AND e.fence=g.fence AND e.state='running'`,
    [
      hash(token),
      binding.identity.tenantId,
      binding.identity.executionId,
      binding.identity.taskId,
      binding.identity.stepId,
      binding.identity.operationId,
      binding.toolName,
      binding.sessionKey,
      binding.requestDigest,
    ],
  );
  return result.rows.length === 1;
}

/** Lock execution row against cancellation/takeover while validating and publishing result. */
export async function commitGrantedToolResult(
  db: RuntimeSqlClient,
  token: string,
  binding: Omit<ToolGrantBinding, "owner" | "fence">,
  result: unknown,
): Promise<boolean> {
  const key = executionOperationKey(binding.identity);
  const encoded = JSON.stringify(result);
  if (encoded === undefined) {
    throw new Error("Tool result must be serializable");
  }
  const committed = await db.query(
    `WITH owned AS (
  SELECT e.tenant_id,e.execution_id,e.fence FROM runtime_tool_execution_grants g
  JOIN runtime_executions e ON e.tenant_id=g.tenant_id AND e.execution_id=g.execution_id
  WHERE g.token_hash=$1 AND g.tenant_id=$2 AND g.execution_id=$3 AND g.task_id=$4
    AND g.step_id=$5 AND g.operation_id=$6 AND g.tool_name=$7 AND g.session_key=$8 AND g.request_digest=$9
    AND g.expires_at>clock_timestamp() AND e.lease_expires_at>clock_timestamp()
    AND e.lease_owner=g.lease_owner AND e.fence=g.fence AND e.state='running'
  FOR UPDATE OF e
 ) INSERT INTO runtime_tool_results(tenant_id,operation_key,execution_id,request_digest,fence,result)
 SELECT tenant_id,$10,execution_id,$9,fence,$11::jsonb FROM owned
 WHERE EXISTS (SELECT 1 FROM runtime_tool_intents i WHERE i.tenant_id=owned.tenant_id
  AND i.operation_key=$10 AND i.execution_id=owned.execution_id AND i.request_digest=$9
  AND i.fence=owned.fence AND i.grant_hash=$1)
 ON CONFLICT (tenant_id,operation_key) DO UPDATE SET operation_key=runtime_tool_results.operation_key
 WHERE runtime_tool_results.execution_id=EXCLUDED.execution_id
  AND runtime_tool_results.request_digest=EXCLUDED.request_digest AND runtime_tool_results.result=EXCLUDED.result
 RETURNING operation_key`,
    [
      hash(token),
      binding.identity.tenantId,
      binding.identity.executionId,
      binding.identity.taskId,
      binding.identity.stepId,
      binding.identity.operationId,
      binding.toolName,
      binding.sessionKey,
      binding.requestDigest,
      key,
      encoded,
    ],
  );
  return committed.rows.length === 1;
}

/** Durable at-most-once admission. Orphan intent is unknown, never an automatic retry. */
export async function claimGrantedToolIntent(
  db: RuntimeSqlClient,
  token: string,
  binding: Omit<ToolGrantBinding, "owner" | "fence">,
): Promise<"claimed" | "unknown" | "denied"> {
  const key = executionOperationKey(binding.identity);
  const result = await db.query(
    `WITH owned AS (
  SELECT e.tenant_id,e.execution_id,e.fence FROM runtime_tool_execution_grants g
  JOIN runtime_executions e ON e.tenant_id=g.tenant_id AND e.execution_id=g.execution_id
  WHERE g.token_hash=$1 AND g.tenant_id=$2 AND g.execution_id=$3 AND g.task_id=$4
    AND g.step_id=$5 AND g.operation_id=$6 AND g.tool_name=$7 AND g.session_key=$8 AND g.request_digest=$9
    AND g.expires_at>clock_timestamp() AND e.lease_expires_at>clock_timestamp()
    AND e.lease_owner=g.lease_owner AND e.fence=g.fence AND e.state='running'
  FOR UPDATE OF e
 ), inserted AS (
  INSERT INTO runtime_tool_intents(tenant_id,operation_key,execution_id,request_digest,fence,grant_hash)
  SELECT tenant_id,$10,execution_id,$9,fence,$1 FROM owned ON CONFLICT DO NOTHING RETURNING operation_key
 ) SELECT EXISTS(SELECT 1 FROM owned) AS authorized,EXISTS(SELECT 1 FROM inserted) AS claimed`,
    [
      hash(token),
      binding.identity.tenantId,
      binding.identity.executionId,
      binding.identity.taskId,
      binding.identity.stepId,
      binding.identity.operationId,
      binding.toolName,
      binding.sessionKey,
      binding.requestDigest,
      key,
    ],
  );
  if (result.rows[0]?.authorized !== true) {
    return "denied";
  }
  return result.rows[0]?.claimed === true ? "claimed" : "unknown";
}
