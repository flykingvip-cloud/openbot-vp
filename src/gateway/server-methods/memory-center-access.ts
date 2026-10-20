import { DEFAULT_MEMORY_ALT_FILENAME, DEFAULT_MEMORY_FILENAME } from "../../agents/workspace.js";
import { loadConfig } from "../../config/config.js";
import {
  isAgentOwnedByEmployeeUser,
  isPersonalWorkbenchClient,
  resolveEmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { listAgentsForGateway } from "../session-utils.js";
import type { GatewayClient, RespondFn } from "./types.js";

const AGENT_MEMORY_WORKSPACE_FILES = new Set<string>([
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
]);

/** True for MEMORY.md / memory.md workspace files (content-bearing). */
export function isAgentMemoryWorkspaceFile(name: string): boolean {
  return AGENT_MEMORY_WORKSPACE_FILES.has(name.trim());
}

/**
 * Memory Center content RPCs must never expose employee private memory to enterprise-admin
 * sessions. Personal workbench callers may only touch agents they own / are seat-granted.
 */
export async function assertMemoryCenterAgentAccess(params: {
  client: GatewayClient | null;
  agentId: string;
  respond: RespondFn;
  method: string;
}): Promise<boolean> {
  const { client, agentId, respond, method } = params;

  if (client?.sessionDomain === "enterprise") {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `${method} cannot expose employee private memory to enterprise admin sessions; use enterprise-memory.governance.overview for org-owned scopes only`,
      ),
    );
    return false;
  }

  if (!isPersonalWorkbenchClient(client)) {
    return true;
  }

  const actor = await resolveEmployeeWorkbenchActor(client);
  if (!actor) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `${method} requires a resolved employee actor for personal workbench sessions`,
      ),
    );
    return false;
  }

  const cfg = loadConfig();
  const agent = listAgentsForGateway(cfg).agents.find((entry) => entry.id === agentId);
  if (!agent || !isAgentOwnedByEmployeeUser(agent, actor)) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        `you do not have permission to access memory for agent "${agentId}"`,
      ),
    );
    return false;
  }

  return true;
}
