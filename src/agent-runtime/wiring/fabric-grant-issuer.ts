import type { ToolInvokeRequest } from "@openbot/aor-core";
import type { RuntimeSqlClient } from "../state/postgres/execution.js";
import { issueToolExecutionGrant } from "../state/postgres/tool-execution-grant.js";
import { toolExecutionRequestDigest } from "./http-execution-grant.js";

/** A single admitted execution's host-owned lease. Never accepts owner/fence from HTTP body. */
export function createFabricGrantIssuer(input: {
  db: RuntimeSqlClient;
  tenantId: string;
  taskId: string;
  executionId: string;
  owner: string;
  fence: string;
  sessionKey: string;
  signal: AbortSignal;
}) {
  return async (request: ToolInvokeRequest): Promise<string> => {
    input.signal.throwIfAborted();
    const identity = request.operationIdentity;
    if (
      !identity ||
      identity.tenantId !== input.tenantId ||
      identity.taskId !== input.taskId ||
      identity.executionId !== input.executionId ||
      request.sessionKey !== input.sessionKey
    ) {
      throw new Error("Fabric invocation conflicts with admitted host execution");
    }
    const token = await issueToolExecutionGrant(input.db, {
      identity,
      owner: input.owner,
      fence: input.fence,
      toolName: request.tool,
      sessionKey: input.sessionKey,
      requestDigest: toolExecutionRequestDigest(
        request.tool,
        input.sessionKey,
        request.action,
        request.args ?? {},
      ),
    });
    input.signal.throwIfAborted();
    return token;
  };
}
