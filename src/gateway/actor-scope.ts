import {
  isPersonalWorkbenchClient,
  isSessionVisibleToEmployeeUser,
  resolveEmployeeWorkbenchActor,
  type EmployeeWorkbenchActor,
} from "./employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";
import type { GatewayClient, RespondFn } from "./server-methods/types.js";

export type { EmployeeWorkbenchActor } from "./employee-workbench-scope.js";

export type GatewayActorScope =
  | { mode: "platform" }
  | { mode: "employee"; actor: EmployeeWorkbenchActor };

export type EmployeeSessionVisibilityContext = {
  actor: EmployeeWorkbenchActor;
  visibleAgentIds: Set<string>;
  visibleSpaceIds: Set<string>;
  auditableGroupBotSessions: Set<string>;
  archivedGroupIds: Set<string>;
};

/** Unified actor resolution for RPC tenant/user scoping (security P1.1). */
export async function resolveGatewayActorScope(
  client: GatewayClient | null | undefined,
): Promise<GatewayActorScope> {
  const actor = await resolveEmployeeWorkbenchActor(client);
  if (actor && isPersonalWorkbenchClient(client)) {
    return { mode: "employee", actor };
  }
  return { mode: "platform" };
}

export function isSessionKeyVisibleToEmployeeActor(
  sessionKey: string,
  ctx: EmployeeSessionVisibilityContext,
): boolean {
  const key = sessionKey.trim();
  if (!key) {
    return false;
  }
  if (ctx.archivedGroupIds.size > 0) {
    const parsedGroup = key.match(/group:([^:]+)/i)?.[1];
    if (parsedGroup && ctx.archivedGroupIds.has(parsedGroup.trim().toLowerCase())) {
      return false;
    }
  }
  return isSessionVisibleToEmployeeUser(
    { key },
    ctx.actor,
    ctx.visibleAgentIds,
    ctx.visibleSpaceIds,
    ctx.auditableGroupBotSessions,
  );
}

export function filterSessionKeysForEmployeeActor(
  keys: string[],
  ctx: EmployeeSessionVisibilityContext,
): string[] {
  return keys.filter((key) => isSessionKeyVisibleToEmployeeActor(key, ctx));
}

/** Block global gateway config mutations from personal workbench sessions. */
export function rejectPersonalWorkbenchGlobalConfigAccess(params: {
  client: GatewayClient | null | undefined;
  method: string;
  respond: RespondFn;
}): boolean {
  if (!isPersonalWorkbenchClient(params.client)) {
    return false;
  }
  params.respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `${params.method} on global gateway config is not allowed from personal workbench sessions; use tenant-scoped config with tenantId`,
    ),
  );
  return true;
}
