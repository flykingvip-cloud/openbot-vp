import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { executionOperationKey } from "../contracts/operation.js";
import type { OperationIdentity } from "../contracts/operation.js";
import {
  RUNTIME_PG_OPTIONS,
  withRuntimeDeadline,
  RUNTIME_SHUTDOWN_MS,
} from "../state/postgres/deadline.js";
import { claimGrantedToolIntent } from "../state/postgres/tool-execution-grant.js";
import {
  commitGrantedToolResult,
  validateToolExecutionGrant,
} from "../state/postgres/tool-execution-grant.js";
import { ToolOperationOutcomeUnknownError } from "../state/repository/tool-operation.js";
export function toolExecutionRequestDigest(
  tool: string,
  sessionKey: string,
  action: unknown,
  args: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify([tool, sessionKey, action ?? null, args]))
    .digest("hex");
}
export async function verifyHttpExecutionGrant(input: {
  token: string;
  identity: OperationIdentity;
  tool: string;
  sessionKey: string;
  action: unknown;
  args: unknown;
  commitResult?: { value: unknown };
}): Promise<boolean> {
  const url = process.env.OPENBOT_RUNTIME_DATABASE_URL?.trim();
  if (!url || !input.token) {
    return false;
  }
  const { Pool } = createRequire(import.meta.url)("pg");
  const db = new Pool({ connectionString: url, ...RUNTIME_PG_OPTIONS });
  try {
    const binding = {
      identity: input.identity,
      toolName: input.tool,
      sessionKey: input.sessionKey,
      requestDigest: toolExecutionRequestDigest(
        input.tool,
        input.sessionKey,
        input.action,
        input.args,
      ),
    };
    return input.commitResult
      ? await commitGrantedToolResult(db, input.token, binding, input.commitResult.value)
      : await validateToolExecutionGrant(db, input.token, binding);
  } finally {
    await withRuntimeDeadline(db.end(), RUNTIME_SHUTDOWN_MS, "Execution grant pool shutdown");
  }
}

export async function executeHttpGrantedOperation(input: {
  token: string;
  identity: OperationIdentity;
  tool: string;
  sessionKey: string;
  action: unknown;
  args: unknown;
  execute: () => Promise<unknown>;
}): Promise<unknown> {
  const url = process.env.OPENBOT_RUNTIME_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("Runtime database required");
  }
  const { Pool } = createRequire(import.meta.url)("pg");
  const db = new Pool({ connectionString: url, ...RUNTIME_PG_OPTIONS });
  const binding = {
    identity: input.identity,
    toolName: input.tool,
    sessionKey: input.sessionKey,
    requestDigest: toolExecutionRequestDigest(
      input.tool,
      input.sessionKey,
      input.action,
      input.args,
    ),
  };
  const key = executionOperationKey(input.identity);
  try {
    if (!(await validateToolExecutionGrant(db, input.token, binding))) {
      throw new Error("Execution grant invalid");
    }
    const prior = await db.query(
      "SELECT result,request_digest FROM runtime_tool_results WHERE tenant_id=$1 AND operation_key=$2 AND execution_id=$3",
      [input.identity.tenantId, key, input.identity.executionId],
    );
    if (prior.rows.length) {
      if (prior.rows[0].request_digest !== binding.requestDigest) {
        throw new Error("Operation result request conflict");
      }
      return prior.rows[0].result;
    }
    const admission = await claimGrantedToolIntent(db, input.token, binding);
    if (admission !== "claimed") {
      throw new ToolOperationOutcomeUnknownError(key);
    }
    const result = await input.execute();
    if (!(await commitGrantedToolResult(db, input.token, binding, result))) {
      throw new ToolOperationOutcomeUnknownError(key);
    }
    return result;
  } finally {
    await withRuntimeDeadline(db.end(), RUNTIME_SHUTDOWN_MS, "Granted operation shutdown");
  }
}

export async function resolveGrantedHttpIdentity(
  input: Parameters<typeof verifyHttpExecutionGrant>[0],
): Promise<{ enterpriseId: string; platformUserId: string; sessionDomain: "enterprise" } | null> {
  if (!(await verifyHttpExecutionGrant(input))) {
    return null;
  }
  const { Pool } = createRequire(import.meta.url)("pg");
  const db = new Pool({
    connectionString: process.env.OPENBOT_RUNTIME_DATABASE_URL,
    ...RUNTIME_PG_OPTIONS,
  });
  try {
    const result = await db.query(
      "SELECT payload->>'userId' AS user_id FROM runtime_executions WHERE tenant_id=$1 AND execution_id=$2 AND payload->>'ingress'='fabric'",
      [input.identity.tenantId, input.identity.executionId],
    );
    const user = result.rows[0]?.user_id;
    return typeof user === "string" && user.trim()
      ? { enterpriseId: input.identity.tenantId, platformUserId: user, sessionDomain: "enterprise" }
      : null;
  } finally {
    await withRuntimeDeadline(db.end(), RUNTIME_SHUTDOWN_MS, "Grant identity shutdown");
  }
}
