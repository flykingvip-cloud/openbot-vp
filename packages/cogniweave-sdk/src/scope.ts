import { ValidationError } from "./errors.js";
import type { EngineConfig, Scope, ScopeInput } from "./models.js";

export function resolveScope(scope: ScopeInput | undefined, config?: EngineConfig): Scope {
  const resolved: Scope = {
    workspaceId: scope?.workspaceId ?? config?.defaultScope?.workspaceId ?? "",
    projectId: scope?.projectId ?? config?.defaultScope?.projectId ?? "",
    agentId: scope?.agentId ?? config?.defaultScope?.agentId ?? "",
    visibility: scope?.visibility ?? config?.defaultScope?.visibility ?? "private",
  };

  validateScope(resolved);
  return resolved;
}

export function validateScope(scope: Scope): void {
  if (!scope.workspaceId || !scope.projectId || !scope.agentId) {
    throw new ValidationError("scope requires workspaceId, projectId, and agentId");
  }
  if (scope.visibility !== "private" && scope.visibility !== "shared") {
    throw new ValidationError(`invalid scope visibility: ${scope.visibility}`);
  }
}

export function matchesScope(candidate: Scope, target: Scope): boolean {
  return (
    candidate.workspaceId === target.workspaceId &&
    candidate.projectId === target.projectId &&
    candidate.agentId === target.agentId &&
    candidate.visibility === target.visibility
  );
}
